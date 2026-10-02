// FeathersRecordSource: one Feathers service, as a source of one kind of record.

/** Ends a subscription. Whatever subscribes keeps it and calls it at the end of its own life. */
export type Unsubscribe = () => void

export type RecordListener<T> = (record: T) => void

/** What every record has. */
export interface HasId {
    id: string
}

/** A record to create. Without an `id`, the data service assigns one. */
export type NewRecord<T extends HasId> = Omit<T, 'id'> & { id?: string }

type BackendRecord = Record<string, unknown>

/** What `find` may return: a page, an array or a single record. */
type FindResult = BackendRecord | BackendRecord[] | { data?: BackendRecord[] }

type ChangeEvent = 'created' | 'updated' | 'patched' | 'removed'

/**
 * The part of a Feathers service a record source uses. A service of a
 * Feathers client satisfies it, and so does a fake in a test.
 */
export interface FeathersServiceLike {
    find(params?: { query?: Record<string, unknown> }): Promise<unknown>
    get(id: string): Promise<unknown>
    create(data: BackendRecord): Promise<unknown>
    update(id: string, data: BackendRecord): Promise<unknown>
    patch(id: string, data: BackendRecord): Promise<unknown>
    remove(id: string): Promise<unknown>
    on(event: string, listener: (record: any) => void): unknown
    off(event: string, listener: (record: any) => void): unknown
}

export interface FeathersRecordSourceOptions {
    /** The backend's name for the record ID, when it is not `id` (for example `_id`). */
    idField?: string
    /** A fixed query for `find`, when the source covers only a part of the service's records. */
    query?: Record<string, unknown>
}

/**
 * Access to the records of one Feathers service and to its change events.
 * It does not load records on its own: whatever uses it calls `find`.
 * A failed call rejects with Feathers' own error, unchanged, so a missing
 * record (`NotFound`, code 404) can be told from any other failure.
 */
export class FeathersRecordSource<T extends HasId> {
    #service: FeathersServiceLike
    #idField: string
    #query: Record<string, unknown> | undefined

    constructor(service: FeathersServiceLike, options: FeathersRecordSourceOptions = {}) {
        this.#service = service
        this.#idField = options.idField ?? 'id'
        this.#query = options.query
    }

    /** Every record, as an array, whether the service returns a page, an array or a single record. */
    async find(): Promise<T[]> {
        const result = (await this.#service.find(this.#query ? { query: this.#query } : undefined)) as FindResult

        return toArray(result).map(record => this.#toRecord(record))
    }

    /** One record. Rejects when it does not exist. */
    async get(id: string): Promise<T> {
        return this.#toRecord(await this.#service.get(id))
    }

    async create(data: NewRecord<T>): Promise<T> {
        return this.#toRecord(await this.#service.create(this.#toBackend(data)))
    }

    async update(id: string, data: T): Promise<T> {
        return this.#toRecord(await this.#service.update(id, this.#toBackend(data)))
    }

    async patch(id: string, data: Partial<T>): Promise<T> {
        return this.#toRecord(await this.#service.patch(id, this.#toBackend(data)))
    }

    async remove(id: string): Promise<T> {
        return this.#toRecord(await this.#service.remove(id))
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

    #on(event: ChangeEvent, listener: RecordListener<T>): Unsubscribe {
        // A wrapper of its own, so the same function subscribed twice is two subscriptions
        const entry = (record: unknown) => listener(this.#toRecord(record))

        this.#service.on(event, entry)

        return () => {
            this.#service.off(event, entry)
        }
    }

    #toRecord(backend: unknown): T {
        if (this.#idField === 'id') return backend as T

        const { [this.#idField]: id, ...rest } = backend as BackendRecord

        return { ...rest, id } as T
    }

    #toBackend(data: object): BackendRecord {
        if (this.#idField === 'id') return data as BackendRecord

        const { id, ...rest } = data as BackendRecord

        return id === undefined ? rest : { ...rest, [this.#idField]: id }
    }
}

function toArray(result: FindResult): BackendRecord[] {
    if (Array.isArray(result)) return result
    if ('data' in result && Array.isArray(result.data)) return result.data

    return [result as BackendRecord]
}
