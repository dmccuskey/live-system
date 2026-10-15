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
    skip?: number
}

/** What `find` may return: a page, an array or a single record. */
type FindResult = BackendRecord | BackendRecord[] | Page

/** What `findPage` is asked for. */
export interface FindPageOptions {
    /** A Feathers query for this call: fields to narrow by, `$sort`, `$select`. */
    query?: Record<string, unknown>
    /** How many records at most. With 0, none: the answer is then the number of records alone. */
    limit: number
    /** How many records to pass over first. 0 unless given. */
    skip?: number
}

/** A part of a service's records, as `findPage` answers it. */
export interface RecordPage<T> {
    records: T[]
    /**
     * How many records the query matches in all. `undefined` when the service
     * did not answer with a page: it does not paginate, or it does not know
     * `$limit` and `$skip` at all, and then `records` may not be a page either.
     */
    total: number | undefined
    /** The limit the service applied, which may be lower than the one asked for. The one asked for, without a page. */
    limit: number
    /** The skip the service applied. The one asked for, without a page. */
    skip: number
}

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

/**
 * How a record source turns the backend's records into its own and back, in
 * place of the default conversion. For a record type that is not the
 * backend's record with its ID renamed: one that keeps the record as the
 * backend has it, for example, beside an `id` to find it by.
 */
export interface RecordConversion<T extends HasId> {
    /** Makes a record of what the backend gave. Its `id` must be a string. */
    read(backend: Record<string, unknown>): T
    /** Makes what the backend is sent of a record, or of the part of one a patch holds. */
    write(data: Partial<T>): Record<string, unknown>
}

export interface FeathersRecordSourceOptions<T extends HasId = HasId> {
    /**
     * The backend's name for the record ID, when it is not `id` (for example
     * `_id`). `find()` sorts and pages by it. A backend record that has a field
     * `id` of its own beside it is refused: use `convert` for such a service.
     */
    idField?: string
    /**
     * Replaces the default conversion. With it, `idField` only names the
     * backend's ID field for `find()`'s paging: `convert` makes the ID itself.
     */
    convert?: RecordConversion<T>
    /**
     * Called when the record of a change event cannot be converted, with what
     * the conversion threw. The event is then not delivered: a listener has no
     * caller to pass the failure to. Logs with `console.error` by default.
     */
    onEventError?: (error: unknown) => void
    /** The service's path, for the source's own messages. `connection.recordSource()` supplies it. */
    path?: string
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
    #convert: RecordConversion<T> | undefined
    #onReconnected: ((listener: () => void) => Unsubscribe) | undefined
    #onEventError: (error: unknown) => void
    #name: string

    constructor(service: FeathersServiceLike, options: FeathersRecordSourceOptions<T> = {}) {
        this.#service = service
        this.#idField = options.idField ?? 'id'
        this.#convert = options.convert
        this.#onReconnected = options.onReconnected

        const name = options.path === undefined ? 'FeathersRecordSource' : `FeathersRecordSource '${options.path}'`
        this.#name = name

        this.#onEventError =
            options.onEventError ??
            (error =>
                console.error(`${name}: a change event was not delivered, its record could not be converted`, error))
    }

    /**
     * Every record, as an array, whether the service returns pages, an array
     * or a single record. From a paginated service it reads page after page,
     * sorted by the ID and each page after the IDs read so far, so a record
     * created or removed meanwhile does not shift the pages: every record that
     * exists throughout the reading is read once. The records come in ID order.
     */
    async find(): Promise<T[]> {
        const sort = { $sort: { [this.#idField]: 1 } }
        const first = (await this.#service.find({ query: sort })) as FindResult

        if (!isPage(first)) return toArray(first).map(record => this.#toRecord(record))

        const records = [...first.data]
        const read = new Set(records.map(record => record[this.#idField]))
        let page = first

        while (hasMore(page)) {
            const last = records[records.length - 1]![this.#idField]

            if (last === undefined || last === null) {
                throw new Error(
                    `${this.#name}: a record has no ID field \`${this.#idField}\` to page by. With \`convert\`, ` +
                        `name the backend's ID field with \`idField\`.`,
                )
            }

            const next = (await this.#service.find({
                query: { ...sort, [this.#idField]: { $gt: last } },
            })) as FindResult

            if (!isPage(next)) break

            // A service that ignores $gt answers the same page again, and would never end
            if (next.data.some(record => read.has(record[this.#idField]))) {
                throw new Error(
                    `${this.#name}: a page repeated records already read. find() pages by \`$sort\` and \`$gt\` ` +
                        `on the ID field \`${this.#idField}\`, which the service must know.`,
                )
            }

            page = next

            for (const record of page.data) {
                records.push(record)
                read.add(record[this.#idField])
            }
        }

        return records.map(record => this.#toRecord(record))
    }

    /**
     * One page of the records, and how many there are in all. For a service
     * too large to read whole, and for a query that changes from call to call.
     * It asks the service with `$limit` and `$skip`, which a service on a
     * Feathers database adapter knows. What another service makes of them is
     * its own: only a `total` in the answer says that the service paged.
     */
    async findPage(options: FindPageOptions): Promise<RecordPage<T>> {
        const skip = options.skip ?? 0
        const result = (await this.#service.find({
            query: { ...options.query, $limit: options.limit, $skip: skip },
        })) as FindResult

        if (!isPage(result)) {
            return {
                records: toArray(result).map(record => this.#toRecord(record)),
                total: undefined,
                limit: options.limit,
                skip,
            }
        }

        return {
            records: result.data.map(record => this.#toRecord(record)),
            total: typeof result.total === 'number' ? result.total : undefined,
            limit: result.limit ?? options.limit,
            skip: result.skip ?? skip,
        }
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
        const entry = (backend: unknown) => {
            let record: T

            // Thrown from here, the failure would reach the socket's own handler, and in Node could end the process
            try {
                record = this.#toRecord(backend)
            } catch (error) {
                this.#onEventError(error)
                return
            }

            listener(record)
        }

        this.#service.on(event, entry)

        return () => {
            this.#service.off(event, entry)
        }
    }

    // The default conversion: the backend's record, with its ID under `id` and as a string
    #toRecord(backend: unknown): T {
        if (this.#convert) return this.#convert.read(backend as BackendRecord)

        const record = backend as BackendRecord

        if (this.#idField === 'id') {
            return (hasOtherId(record.id) ? { ...record, id: String(record.id) } : record) as T
        }

        if (Object.hasOwn(record, 'id')) {
            throw new Error(
                `A record has a field \`id\` of its own beside its ID field \`${this.#idField}\`, and renaming ` +
                    `\`${this.#idField}\` to \`id\` would lose it. Give the record source \`convert\` in place of \`idField\`.`,
            )
        }

        const { [this.#idField]: id, ...rest } = record

        return { ...rest, id: hasOtherId(id) ? String(id) : id } as T
    }

    #toBackend(data: object): BackendRecord {
        if (this.#convert) return this.#convert.write(data as Partial<T>)
        if (this.#idField === 'id') return data as BackendRecord

        const { id, ...rest } = data as BackendRecord

        return id === undefined ? rest : { ...rest, [this.#idField]: id }
    }
}

// An ID the backend gave in another form than a string: a number, from a SQL service. None is left as it is.
function hasOtherId(id: unknown): boolean {
    return id !== undefined && id !== null && typeof id !== 'string'
}

function isPage(result: FindResult): result is Page {
    return !Array.isArray(result) && 'data' in result && Array.isArray(result.data)
}

/**
 * Whether records follow a page. Each page is the first of what its query
 * matches, so its `total` counts it and what comes after it. An empty page
 * always ends the reading.
 */
function hasMore(page: Page): boolean {
    if (page.data.length === 0) return false
    if (typeof page.total === 'number') return page.data.length < page.total

    // Without a count, a full page may have another behind it
    return typeof page.limit === 'number' && page.data.length >= page.limit
}

function toArray(result: BackendRecord | BackendRecord[]): BackendRecord[] {
    return Array.isArray(result) ? result : [result]
}
