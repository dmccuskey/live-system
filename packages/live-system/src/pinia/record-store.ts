// The record store as a Pinia store, for one kind of record from the data service.
import { defineStore } from 'pinia'
import type { Pinia } from 'pinia'
import type { HasId } from '../core/record-source.ts'
import { recordState } from '../core/record-store.ts'
import type { RecordStore } from '../core/record-store.ts'

/**
 * Defines the Pinia store for one kind of record, under a name unique in the
 * application. What it returns is called with the application's Pinia
 * instance to get the store: `defineRecordStore<UserRecord>('users')(pinia)`.
 * The store is `createRecordStore`'s, with Pinia's devtools.
 */
export function defineRecordStore<T extends HasId>(name: string): (pinia?: Pinia | null) => RecordStore<T> {
    const useStore = defineStore(name, () => recordState<T>())

    // Pinia's own store type does not resolve while T is still a type parameter
    return useStore as unknown as (pinia?: Pinia | null) => RecordStore<T>
}
