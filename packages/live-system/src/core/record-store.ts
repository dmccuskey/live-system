// The record store: what mirrors one kind of record from the data service.
// `createRecordStore` makes one on Vue's reactivity alone; `live-system/pinia`
// has the same store as a Pinia store; an app may bring its own.
import { shallowReactive, shallowRef } from '@vue/reactivity'
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

/**
 * A record store for one kind of record, with no Pinia: what a server or a UI
 * that isn't Vue uses. Each call makes a store of its own.
 */
export function createRecordStore<T extends HasId>(): RecordStore<T> {
    const state = recordState<T>()

    return {
        get records() {
            return state.records.value
        },
        load: state.load,
        set: state.set,
        remove: state.remove,
        get: state.get,
    }
}

/** The state and the actions of a record store, shared by `createRecordStore` and the Pinia store. */
export function recordState<T extends HasId>() {
    // Shallow: a record is held as it is, and its replacement is the change
    const records = shallowRef(shallowReactive({} as Record<string, T>))

    function load(all: T[]): void {
        const next: Record<string, T> = {}

        for (const record of all) {
            next[record.id] = record
        }

        records.value = shallowReactive(next)
    }

    function set(record: T): void {
        records.value[record.id] = record
    }

    function remove(id: string): void {
        delete records.value[id]
    }

    function get(id: string): T | undefined {
        return records.value[id]
    }

    return { records, load, set, remove, get }
}
