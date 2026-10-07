// RecordSource: how a manager reaches one kind of record, whatever stores it.
import type { Unsubscribe } from './unsubscribe.ts'

/** What every record has. A source whose backend names or types the ID otherwise converts it. */
export interface HasId {
    id: string
}

/** A record to create. Without an `id`, the source assigns one, as a backend that creates its own IDs does. */
export type NewRecord<T extends HasId> = Omit<T, 'id'> & { id?: string }

export type RecordListener<T> = (record: T) => void

/**
 * Access to one kind of record and its change events. With Feathers, that is
 * one service. It is not the connection: every record source of an
 * application shares the one connection.
 */
export interface RecordSource<T extends HasId> {
    /** Every record, as an array, whatever the backend returns. */
    find(): Promise<T[]>
    /** One record. Rejects when it does not exist. */
    get(id: string): Promise<T>

    create(data: NewRecord<T>): Promise<T>
    update(id: string, data: T): Promise<T>
    patch(id: string, data: Partial<T>): Promise<T>
    remove(id: string): Promise<T>

    onCreated(listener: RecordListener<T>): Unsubscribe
    onUpdated(listener: RecordListener<T>): Unsubscribe
    onPatched(listener: RecordListener<T>): Unsubscribe
    onRemoved(listener: RecordListener<T>): Unsubscribe

    /**
     * Called when the source is reached again after it was lost. Change events
     * may have been missed meanwhile, so what was loaded may be stale. Never
     * called for the first connection.
     */
    onReconnected(listener: () => void): Unsubscribe
}
