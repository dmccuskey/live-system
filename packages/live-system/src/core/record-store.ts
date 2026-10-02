// The record store: a Pinia store that mirrors one kind of record from the data service.
import { defineStore } from 'pinia'
import type { Pinia } from 'pinia'
import { shallowReactive, shallowRef } from 'vue'
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
 * Defines the Pinia store for one kind of record, under a name unique in the
 * application. What it returns is called with the application's Pinia
 * instance to get the store: `defineRecordStore<UserRecord>('users')(pinia)`.
 */
export function defineRecordStore<T extends HasId>(name: string): (pinia?: Pinia | null) => RecordStore<T> {
    const useStore = defineStore(name, () => {
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
    })

    // Pinia's own store type does not resolve while T is still a type parameter
    return useStore as unknown as (pinia?: Pinia | null) => RecordStore<T>
}
