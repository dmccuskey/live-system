// DataManager: mirrors one kind of record from its record source into its store.
import { isEqual } from './equal.ts'
import { BaseManager } from './manager.ts'
import type { HasId, RecordSource } from './record-source.ts'
import type { RecordStore } from './record-store.ts'
import type { Unsubscribe } from './unsubscribe.ts'

/**
 * A manager for one kind of record. During `init()` it loads every record
 * into its store, missing no change made meanwhile, and from then on applies
 * each change event as it arrives. When its source reports that it was lost
 * and is reached again, it fetches every record again and applies what
 * differs. It never changes the store on its own: a subclass writes through
 * `this.source`, and the change comes back as an event.
 */
export abstract class DataManager<T extends HasId, C = unknown> extends BaseManager<C> {
    #subscriptions: Unsubscribe[] = []
    // The IDs of the records that changed during a sync. Set only while one runs.
    #changed: Set<string> | undefined
    #phase: 'created' | 'loading' | 'live' | 'failed' | 'stopped' = 'created'
    // Counts the syncs: one that is no longer the latest has been overtaken, and applies nothing
    #latestSync = 0
    // Settled by the sync that ends the load, which need not be the one init() began
    #load: PromiseWithResolvers<void> | undefined

    constructor(
        context: C,
        protected readonly source: RecordSource<T>,
        protected readonly records: RecordStore<T>,
    ) {
        super(context)
    }

    /** Subscribes, fetches the snapshot, reconciles what changed meanwhile, and imports the result in one batch. */
    override async init(): Promise<void> {
        this.#phase = 'loading'
        this.#load = Promise.withResolvers<void>()

        this.#subscriptions.push(
            this.source.onCreated(record => this.#handleChange(record)),
            this.source.onUpdated(record => this.#handleChange(record)),
            this.source.onPatched(record => this.#handleChange(record)),
            this.source.onRemoved(record => this.#handleRemoval(record)),
            this.source.onReconnected(() => this.#handleReconnected()),
        )

        void this.#sync()

        await this.#load.promise
    }

    /** Ends the subscriptions. The store keeps what it holds. */
    override async stop(): Promise<void> {
        this.#phase = 'stopped'
        this.#changed = undefined

        for (const unsubscribe of this.#subscriptions.splice(0)) {
            unsubscribe()
        }

        // An init() whose fetch never returns ends here
        this.#load?.resolve()
    }

    /** Called for each record once it is in the store: every record after the load, then each new one. */
    protected recordAdded(_record: T): void {}

    /** Called when a record in the store has been replaced, with what it was before. */
    protected recordChanged(_record: T, _previous: T): void {}

    /** Called when a record has been removed from the store, with what it was. */
    protected recordRemoved(_record: T): void {}

    /**
     * Called when the sync after a reconnect failed. The store keeps what it
     * holds, change events are applied again, and the next reconnect syncs
     * again. Logs with `console.error` by default.
     */
    protected resyncFailed(error: unknown): void {
        console.error(`${this.constructor.name}: the sync after a reconnect failed`, error)
    }

    // The source was lost and is back. A sync that was running may never return, so a new one overtakes it.
    #handleReconnected(): void {
        if (this.#phase !== 'loading' && this.#phase !== 'live') return

        void this.#sync()
    }

    // Fetches every record with nothing missed, then loads the store (the first time) or applies what differs
    async #sync(): Promise<void> {
        const sync = ++this.#latestSync
        const isOvertaken = () => sync !== this.#latestSync || this.#phase === 'stopped'
        const changed = new Set<string>()
        this.#changed = changed

        try {
            const fetched = await this.#fetch(changed)

            if (isOvertaken()) return

            this.#changed = undefined

            if (this.#phase === 'live') {
                this.#applyDifference(fetched)
                return
            }

            this.records.load([...fetched.values()])

            for (const record of fetched.values()) {
                this.recordAdded(record)
            }

            this.#phase = 'live'
            this.#load?.resolve()
        } catch (error) {
            if (isOvertaken()) return

            if (this.#phase === 'live') {
                this.#changed = undefined
                this.resyncFailed(error)
            } else {
                this.#phase = 'failed'
                this.#load?.reject(error)
            }
        }
    }

    // The snapshot, with every record that changed while it was fetched fetched again
    async #fetch(changed: Set<string>): Promise<Map<string, T>> {
        const fetched = new Map<string, T>()

        for (const record of await this.source.find()) {
            fetched.set(record.id, record)
        }

        // Until nothing changed during a round: a change during the refetch is caught by the next
        while (changed.size > 0) {
            const ids = [...changed]
            changed.clear()

            await Promise.all(
                ids.map(async id => {
                    try {
                        fetched.set(id, await this.source.get(id))
                    } catch (error) {
                        // Any other failure says nothing of the record, and fails the sync
                        if (!this.source.isNotFound(error)) throw error

                        fetched.delete(id)
                    }
                }),
            )
        }

        return fetched
    }

    // Brings the store to what was fetched. A record that is equal is left as it is, so nothing watching it reacts.
    #applyDifference(fetched: Map<string, T>): void {
        const removed = Object.values(this.records.records).filter(record => !fetched.has(record.id))
        const added: T[] = []
        const replaced: [record: T, previous: T][] = []

        for (const record of fetched.values()) {
            const previous = this.records.get(record.id)

            if (!previous) {
                added.push(record)
            } else if (!isEqual(record, previous)) {
                replaced.push([record, previous])
            }
        }

        for (const record of removed) this.records.remove(record.id)
        for (const [record] of replaced) this.records.set(record)
        for (const record of added) this.records.set(record)

        // Once the store is whole, as after the load
        for (const record of removed) this.recordRemoved(record)
        for (const [record, previous] of replaced) this.recordChanged(record, previous)
        for (const record of added) this.recordAdded(record)
    }

    #handleChange(record: T): void {
        if (this.#changed) {
            this.#changed.add(record.id)
            return
        }

        const previous = this.records.get(record.id)
        this.records.set(record)

        if (previous) {
            this.recordChanged(record, previous)
        } else {
            this.recordAdded(record)
        }
    }

    #handleRemoval(record: T): void {
        if (this.#changed) {
            this.#changed.add(record.id)
            return
        }

        const previous = this.records.get(record.id)

        if (!previous) return

        this.records.remove(record.id)
        this.recordRemoved(previous)
    }
}
