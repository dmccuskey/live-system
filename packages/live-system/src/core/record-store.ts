// The record store: what mirrors one kind of record from the data service.
// `live-system/pinia` has the Pinia store; an app may bring its own.
import type { HasId } from './record-source.ts'

/**
 * The store of one kind of record. Only a `DataManager` writes to it, from
 * the data service's events; everything else reads. A record is replaced
 * whole when it changes, never changed in place, so what watches a record
 * reacts to the replacement.
 */
export interface RecordStore<T extends HasId> {
    /** The records, by ID. Reactive: reading it in a `computed` or a `watch` tracks the records read. */
    readonly records: Readonly<Record<string, T>>
    /** Replaces every record in one change, so what watches the store reacts once. */
    load(records: T[]): void
    set(record: T): void
    remove(id: string): void
    get(id: string): T | undefined
}
