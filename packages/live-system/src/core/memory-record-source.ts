// MemoryRecordSource: a record source that keeps its records in memory, for tests.
import type { HasId, NewRecord, RecordListener, RecordSource } from './record-source.ts'
import type { Unsubscribe } from './unsubscribe.ts'

type ChangeEvent = 'created' | 'updated' | 'patched' | 'removed'

/**
 * A record source with no backend. It behaves as a data service does: every
 * change emits its event, and records are handed out as copies, so nothing
 * outside can change what it holds.
 */
export class MemoryRecordSource<T extends HasId> implements RecordSource<T> {
    #records = new Map<string, T>()
    #listeners: Record<ChangeEvent, Set<RecordListener<T>>> = {
        created: new Set(),
        updated: new Set(),
        patched: new Set(),
        removed: new Set(),
    }

    constructor(records: T[] = []) {
        for (const record of records) {
            this.#records.set(record.id, structuredClone(record))
        }
    }

    async find(): Promise<T[]> {
        return [...this.#records.values()].map(record => structuredClone(record))
    }

    async get(id: string): Promise<T> {
        return structuredClone(this.#existing(id))
    }

    async create(data: NewRecord<T>): Promise<T> {
        const record = { ...structuredClone(data), id: data.id ?? crypto.randomUUID() } as T

        if (this.#records.has(record.id)) {
            throw new Error(`A record with the ID '${record.id}' already exists`)
        }

        return this.#store('created', record)
    }

    async update(id: string, data: T): Promise<T> {
        this.#existing(id)

        return this.#store('updated', { ...structuredClone(data), id })
    }

    async patch(id: string, data: Partial<T>): Promise<T> {
        return this.#store('patched', { ...this.#existing(id), ...structuredClone(data), id })
    }

    async remove(id: string): Promise<T> {
        const record = this.#existing(id)

        this.#records.delete(id)
        this.#emit('removed', record)

        return structuredClone(record)
    }

    onCreated(listener: RecordListener<T>): Unsubscribe {
        return this.#on('created', listener)
    }

    onUpdated(listener: RecordListener<T>): Unsubscribe {
        return this.#on('updated', listener)
    }

    onPatched(listener: RecordListener<T>): Unsubscribe {
        return this.#on('patched', listener)
    }

    onRemoved(listener: RecordListener<T>): Unsubscribe {
        return this.#on('removed', listener)
    }

    #existing(id: string): T {
        const record = this.#records.get(id)

        if (!record) throw new Error(`No record with the ID '${id}'`)

        return record
    }

    #store(event: ChangeEvent, record: T): T {
        this.#records.set(record.id, record)
        this.#emit(event, record)

        return structuredClone(record)
    }

    #on(event: ChangeEvent, listener: RecordListener<T>): Unsubscribe {
        // A wrapper of its own, so the same function subscribed twice is two subscriptions
        const entry: RecordListener<T> = record => listener(record)

        this.#listeners[event].add(entry)

        return () => {
            this.#listeners[event].delete(entry)
        }
    }

    #emit(event: ChangeEvent, record: T): void {
        for (const listener of [...this.#listeners[event]]) {
            listener(structuredClone(record))
        }
    }
}
