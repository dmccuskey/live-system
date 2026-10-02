// DataManager: mirrors one kind of record from its record source into its store.
import { BaseManager } from './manager.ts'
import type { HasId, RecordSource } from './record-source.ts'
import type { RecordStore } from './record-store.ts'
import type { Unsubscribe } from './unsubscribe.ts'

/**
 * A manager for one kind of record. During `init()` it loads every record
 * into its store, missing no change made meanwhile, and from then on applies
 * each change event as it arrives. It never changes the store on its own: a
 * subclass writes through `this.source`, and the change comes back as an event.
 */
export abstract class DataManager<T extends HasId, C = unknown> extends BaseManager<C> {
    #subscriptions: Unsubscribe[] = []
    // The IDs of the records that changed during the load. Set only while loading.
    #changed: Set<string> | undefined
    #stopped = false

    constructor(
        context: C,
        protected readonly source: RecordSource<T>,
        protected readonly records: RecordStore<T>
    ) {
        super(context)
    }

    /** Subscribes, fetches the snapshot, reconciles what changed meanwhile, and imports the result in one batch. */
    override async init(): Promise<void> {
        const changed = new Set<string>()
        this.#changed = changed

        this.#subscriptions.push(
            this.source.onCreated(record => this.#handleChange(record)),
            this.source.onUpdated(record => this.#handleChange(record)),
            this.source.onPatched(record => this.#handleChange(record)),
            this.source.onRemoved(record => this.#handleRemoval(record))
        )

        const loaded = new Map<string, T>()

        for (const record of await this.source.find()) {
            loaded.set(record.id, record)
        }

        // Until nothing changed during a round: a change during the refetch is caught by the next
        while (changed.size > 0) {
            const ids = [...changed]
            changed.clear()

            await Promise.all(
                ids.map(async id => {
                    try {
                        loaded.set(id, await this.source.get(id))
                    } catch {
                        // A record that cannot be fetched has been removed
                        loaded.delete(id)
                    }
                })
            )
        }

        if (this.#stopped) return

        this.#changed = undefined
        this.records.load([...loaded.values()])

        for (const record of loaded.values()) {
            this.recordAdded(record)
        }
    }

    /** Ends the subscriptions. The store keeps what it holds. */
    override async stop(): Promise<void> {
        this.#stopped = true
        this.#changed = undefined

        for (const unsubscribe of this.#subscriptions.splice(0)) {
            unsubscribe()
        }
    }

    /** Called for each record once it is in the store: every record after the load, then each new one. */
    protected recordAdded(_record: T): void {}

    /** Called when a record in the store has been replaced, with what it was before. */
    protected recordChanged(_record: T, _previous: T): void {}

    /** Called when a record has been removed from the store, with what it was. */
    protected recordRemoved(_record: T): void {}

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
