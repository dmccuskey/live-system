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

/** One page of a paginated service. `total` is missing when the service does not count. */
interface Page {
    data: BackendRecord[]
    total?: number
    limit?: number
}

/** What `find` may return: a page, an array or a single record. */
type FindResult = BackendRecord | BackendRecord[] | Page

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
    /**
     * A fixed query for `find`, when the source covers only a part of the
     * service's records. With a `$limit` of its own, `find` returns that one
     * page and reads no further.
     */
    query?: Record<string, unknown>
    /**
     * How the source hears that the connection was made again after a lost
     * one. `connection.recordSource()` supplies it. Without it, the source's
     * `onReconnected` listeners are never called.
     */
    onReconnected?: (listener: () => void) => Unsubscribe
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
    #onReconnected: ((listener: () => void) => Unsubscribe) | undefined

    constructor(service: FeathersServiceLike, options: FeathersRecordSourceOptions = {}) {
        this.#service = service
        this.#idField = options.idField ?? 'id'
        this.#query = options.query
        this.#onReconnected = options.onReconnected
    }

    /**
     * Every record, as an array, whether the service returns pages, an array
     * or a single record. From a paginated service it reads page after page.
     */
    async find(): Promise<T[]> {
        const first = (await this.#service.find(this.#query ? { query: this.#query } : undefined)) as FindResult

        if (!isPage(first)) return toArray(first).map(record => this.#toRecord(record))

        const records = [...first.data]

        // A query with a $limit of its own asks for that many: its one page is the answer
        if (this.#query?.$limit === undefined) {
            const start = Number(this.#query?.$skip ?? 0)
            let page = first

            while (hasMore(page, start + records.length)) {
                const next = (await this.#service.find({
                    query: { ...this.#query, $skip: start + records.length },
                })) as FindResult

                if (!isPage(next)) break

                page = next
                records.push(...page.data)
            }
        }

        return records.map(record => this.#toRecord(record))
    }

    /** One record. Rejects when it does not exist. */
    async get(id: string): Promise<T> {
        return this.#toRecord(await this.#service.get(id))
    }

    /** Whether what a call rejected with is Feathers' `NotFound`: the record does not exist. */
    isNotFound(error: unknown): boolean {
        return (error as { code?: unknown } | null | undefined)?.code === 404
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

    /**
     * Called when the connection is made again after a lost one. Change events
     * may have been missed meanwhile, so what was loaded may be stale.
     */
    onReconnected(listener: () => void): Unsubscribe {
        return this.#onReconnected?.(listener) ?? (() => {})
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

function isPage(result: FindResult): result is Page {
    return !Array.isArray(result) && 'data' in result && Array.isArray(result.data)
}

/**
 * Whether records follow a page, `read` being how far into the service's
 * records the pages so far reach. An empty page always ends the reading.
 */
function hasMore(page: Page, read: number): boolean {
    if (page.data.length === 0) return false
    if (typeof page.total === 'number') return read < page.total

    // Without a count, a full page may have another behind it
    return typeof page.limit === 'number' && page.data.length >= page.limit
}

function toArray(result: BackendRecord | BackendRecord[]): BackendRecord[] {
    return Array.isArray(result) ? result : [result]
}
