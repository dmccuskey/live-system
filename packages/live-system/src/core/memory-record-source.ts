// MemoryRecordSource: a record source that keeps its records in memory, for tests.
import type { HasId, NewRecord, RecordListener, RecordSource } from './record-source.ts'
import type { Unsubscribe } from './unsubscribe.ts'

type ChangeEvent = 'created' | 'updated' | 'patched' | 'removed'

class RecordNotFoundError extends Error {}

/**
 * A record source with no backend. It behaves as a data service does: every
 * change emits its event, and records are handed out as copies, so nothing
 * outside can change what it holds.
 *
 * A test of a lost connection calls `disconnect()`, changes records, and calls
 * `reconnect()`: the changes made between the two emit no event, as if
 * another client had made them while the data service could not be reached.
 */
export class MemoryRecordSource<T extends HasId> implements RecordSource<T> {
    #records = new Map<string, T>()
    #listeners: Record<ChangeEvent, Set<RecordListener<T>>> = {
        created: new Set(),
        updated: new Set(),
        patched: new Set(),
        removed: new Set(),
    }
    #reconnectedListeners = new Set<() => void>()
    #connected = true

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

    isNotFound(error: unknown): boolean {
        return error instanceof RecordNotFoundError
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

    onReconnected(listener: () => void): Unsubscribe {
        const entry = () => listener()

        this.#reconnectedListeners.add(entry)

        return () => {
            this.#reconnectedListeners.delete(entry)
        }
    }

    /** From here on no change emits its event, until `reconnect()`. The calls still work. */
    disconnect(): void {
        this.#connected = false
    }

    /** Changes emit their events again, and the `onReconnected` listeners are called. */
    reconnect(): void {
        this.#connected = true

        for (const listener of [...this.#reconnectedListeners]) {
            listener()
        }
    }

    #existing(id: string): T {
        const record = this.#records.get(id)

        if (!record) throw new RecordNotFoundError(`No record with the ID '${id}'`)

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
        if (!this.#connected) return

        for (const listener of [...this.#listeners[event]]) {
            listener(structuredClone(record))
        }
    }
}
