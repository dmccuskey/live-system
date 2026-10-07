// StatusManager: owns the status records, which hold what each manager reports of itself for the UI to show.
import { INITIAL_STATUS, STATUS_KEYS } from '@virtual-infrastructure/protocol/status/status.constants'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import { DataManager, debouncePatch } from 'live-system/core'
import type { DebouncedPatch, Unsubscribe } from 'live-system/core'
import type { DemoContext } from './context.ts'

// How long a record waits for another change before it is written, in milliseconds
const WRITE_DELAY = 100

/**
 * There is one status record per manager that reports its status, with the
 * manager's key. Its ID is the data service's to give. The manager never
 * writes the record: it announces each change with an event named after
 * itself (`servers.queueChanged`), and this manager writes it, changes close
 * together as one write.
 *
 * Which records there must be is in the protocol's `INITIAL_STATUS`:
 * `init()` begins the one of each key. So far the `ServerManager` reports:
 * the queue's length and the servers' utilization.
 */
export class StatusManager extends DataManager<StatusRecord, DemoContext> {
    #subscriptions: Unsubscribe[] = []
    // The writes to each status record, by the record's key
    #writes = new Map<string, DebouncedPatch<StatusRecord>>()
    #isStopped = false

    /** Loads the records, then begins the status of each key. */
    override async init(): Promise<void> {
        await super.init()

        for (const initial of Object.values(INITIAL_STATUS)) await this.#begin(initial)
    }

    /** Begins to listen for what each manager reports. */
    override async start(): Promise<void> {
        await super.start()

        const { events } = this.context

        this.#subscriptions.push(
            events.on('servers.queueChanged', event =>
                this.#report(STATUS_KEYS.servers, { queueLength: event.length, waitingForRoom: event.waitingForRoom }),
            ),
            events.on('servers.utilizationChanged', event =>
                this.#report(STATUS_KEYS.servers, { utilization: event.utilization }),
            ),
        )
    }

    /** Stops listening, and writes what is still to be written. */
    override async stop(): Promise<void> {
        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()

        this.#isStopped = true
        await Promise.all([...this.#writes.values()].map(write => write.flush().catch(() => {})))

        await super.stop()
    }

    /**
     * A status is of the run it is reported in, so what its record says of an
     * earlier run is replaced by the initial status. A missing record is created.
     */
    async #begin(initial: Omit<StatusRecord, 'id'>): Promise<void> {
        const record = Object.values(this.records.records).find(candidate => candidate.key === initial.key)
        const isStale =
            record && Object.entries(initial).some(([field, value]) => record[field as keyof StatusRecord] !== value)
        const { id } = record ?? (await this.source.create({ ...initial }))

        if (isStale) await this.source.patch(id, initial)

        this.#writes.set(
            initial.key,
            debouncePatch<StatusRecord>(data => this.source.patch(id, data), WRITE_DELAY, {
                clock: this.context.clock,
                onError: error => {
                    if (!this.#isStopped)
                        console.error(`StatusManager: a write of the status '${initial.key}' failed`, error)
                },
            }),
        )
    }

    #report(key: string, data: Partial<StatusRecord>): void {
        this.#writes.get(key)?.patch(data)
    }
}
