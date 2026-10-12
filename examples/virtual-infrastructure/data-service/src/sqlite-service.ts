// SqliteService: a Feathers database adapter that keeps one kind of record in a SQLite table.
import type { Database } from 'bun:sqlite'
import {
    AdapterBase,
    select,
    sorter,
    type AdapterParams,
    type AdapterServiceOptions,
    type PaginationOptions,
} from '@feathersjs/adapter-commons'
import { BadRequest, Conflict, MethodNotAllowed, NotFound } from '@feathersjs/errors'
import type { Id, NullableId, Paginated, Query } from '@feathersjs/feathers'
import sift from 'sift'

export interface StoredRecord {
    id: string
}

/** What a service is set up with: pagination, and which methods may change many records at once. */
export type SqliteServiceOptions = Pick<AdapterServiceOptions, 'paginate' | 'multi'>

interface Row {
    data: string
}

/**
 * The records of one table, each stored whole as JSON beside its ID, so a
 * record gains a field without a change to the table.
 *
 * It is built on Feathers' adapter base, as Feathers' own memory adapter is,
 * so a client finds what it finds on any Feathers database service: a query
 * of fields and operators (`$in`, `$gt`, `$or`…), `$limit`, `$skip`, `$sort`
 * and `$select`, pages with a `total` where pagination is on, and a
 * `BadRequest` for a query it does not know. The query is applied to the
 * records in memory, after every row has been read: fine for a demo's tables.
 *
 * It does not assign IDs: a create hook does.
 */
export class SqliteService<T extends StoredRecord = StoredRecord> extends AdapterBase<
    T,
    T,
    Partial<T>,
    AdapterParams,
    AdapterServiceOptions
> {
    // Not `#` fields: Feathers calls a service through an object that inherits from it
    private readonly db: Database
    private readonly table: string

    constructor(db: Database, table: string, options: SqliteServiceOptions = {}) {
        if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Not a table name: "${table}"`)

        super({ id: 'id', ...options })
        this.db = db
        this.table = table
        db.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
    }

    // The typing is Feathers': a page unless the call turns pagination off. A service set up without it answers an array all the same.
    async find(params: AdapterParams & { paginate: false }): Promise<T[]>
    async find(params?: AdapterParams & { paginate?: PaginationOptions }): Promise<Paginated<T>>
    async find(params?: AdapterParams): Promise<Paginated<T> | T[]>
    async find(params?: AdapterParams): Promise<Paginated<T> | T[]> {
        return this._find({ ...params, query: await this.sanitizeQuery(params) })
    }

    async get(id: Id, params?: AdapterParams): Promise<T> {
        return this._get(id, { ...params, query: await this.sanitizeQuery(params) })
    }

    async create(data: T, params?: AdapterParams): Promise<T>
    async create(data: T[], params?: AdapterParams): Promise<T[]>
    async create(data: T | T[], params?: AdapterParams): Promise<T | T[]> {
        if (Array.isArray(data) && !this.allowsMulti('create', params)) {
            throw new MethodNotAllowed('Can not create multiple entries')
        }

        return this._create(data, params)
    }

    /** Replaces the record. Its ID stays. */
    async update(id: Id, data: T, params?: AdapterParams): Promise<T> {
        return this._update(id, data, { ...params, query: await this.sanitizeQuery(params) })
    }

    /** Merges the top-level fields of `data` into the record. Its ID stays. */
    async patch(id: Id, data: Partial<T>, params?: AdapterParams): Promise<T>
    async patch(id: null, data: Partial<T>, params?: AdapterParams): Promise<T[]>
    async patch(id: NullableId, data: Partial<T>, params?: AdapterParams): Promise<T | T[]> {
        const { $limit: _limit, ...query } = await this.sanitizeQuery(params)

        return this._patch(id, data, { ...params, query })
    }

    async remove(id: Id, params?: AdapterParams): Promise<T>
    async remove(id: null, params?: AdapterParams): Promise<T[]>
    async remove(id: NullableId, params?: AdapterParams): Promise<T | T[]> {
        const { $limit: _limit, ...query } = await this.sanitizeQuery(params)

        return this._remove(id, { ...params, query })
    }

    // The methods below take a query that is already sanitized: Feathers' name for them is "internal"

    async _find(params: AdapterParams & { paginate: false }): Promise<T[]>
    async _find(params?: AdapterParams & { paginate?: PaginationOptions }): Promise<Paginated<T>>
    async _find(params?: AdapterParams): Promise<Paginated<T> | T[]>
    async _find(params: AdapterParams = {}): Promise<Paginated<T> | T[]> {
        const { paginate } = this.getOptions(params)
        const { query, filters } = this.splitQuery(params)

        let records = this.matching(query)

        if (filters.$sort !== undefined) records.sort(sorter(filters.$sort))

        const total = records.length

        if (filters.$skip !== undefined) records = records.slice(filters.$skip)
        if (filters.$limit !== undefined) records = records.slice(0, filters.$limit)

        const data = records.map(select(params, this.id)) as T[]

        return paginate ? { total, limit: filters.$limit, skip: filters.$skip ?? 0, data } : data
    }

    async _get(id: Id, params: AdapterParams = {}): Promise<T> {
        return select(params, this.id)(this.read(id, this.splitQuery(params).query)) as T
    }

    async _create(data: T, params?: AdapterParams): Promise<T>
    async _create(data: T[], params?: AdapterParams): Promise<T[]>
    async _create(data: T | T[], params?: AdapterParams): Promise<T | T[]>
    async _create(data: T | T[], params: AdapterParams = {}): Promise<T | T[]> {
        if (Array.isArray(data)) return Promise.all(data.map(record => this._create(record, params)))
        if (typeof data?.id !== 'string' || data.id === '') throw new BadRequest('A record needs a string id')

        const added = this.db
            .query(`INSERT OR IGNORE INTO ${this.table} (id, data) VALUES (?, ?)`)
            .run(data.id, JSON.stringify(data))

        if (added.changes === 0) throw new Conflict(`A record with id '${data.id}' already exists`)

        return select(params, this.id)(data) as T
    }

    async _update(id: Id, data: T, params: AdapterParams = {}): Promise<T> {
        if (id === null || Array.isArray(data)) {
            throw new BadRequest("You can not replace multiple instances. Did you mean 'patch'?")
        }

        const record = this.read(id, this.splitQuery(params).query)

        return select(params, this.id)(this.write({ ...data, id: record.id })) as T
    }

    async _patch(id: null, data: Partial<T>, params?: AdapterParams): Promise<T[]>
    async _patch(id: Id, data: Partial<T>, params?: AdapterParams): Promise<T>
    async _patch(id: NullableId, data: Partial<T>, params?: AdapterParams): Promise<T | T[]>
    async _patch(id: NullableId, data: Partial<T>, params: AdapterParams = {}): Promise<T | T[]> {
        if (id === null && !this.allowsMulti('patch', params)) {
            throw new MethodNotAllowed('Can not patch multiple entries')
        }

        const { query } = this.splitQuery(params)
        const patched = (record: T) => select(params, this.id)(this.write({ ...record, ...data, id: record.id })) as T

        return id === null ? this.matching(query).map(patched) : patched(this.read(id, query))
    }

    async _remove(id: null, params?: AdapterParams): Promise<T[]>
    async _remove(id: Id, params?: AdapterParams): Promise<T>
    async _remove(id: NullableId, params?: AdapterParams): Promise<T | T[]>
    async _remove(id: NullableId, params: AdapterParams = {}): Promise<T | T[]> {
        if (id === null && !this.allowsMulti('remove', params)) {
            throw new MethodNotAllowed('Can not remove multiple entries')
        }

        const { query } = this.splitQuery(params)
        const removed = (record: T) => {
            this.db.query(`DELETE FROM ${this.table} WHERE id = ?`).run(record.id)

            return select(params, this.id)(record) as T
        }

        return id === null ? this.matching(query).map(removed) : removed(this.read(id, query))
    }

    // What narrows the records (`query`), apart from what orders, cuts and trims them (`filters`)
    private splitQuery(params: AdapterParams): { query: Query; filters: Query } {
        const { $skip, $sort, $limit, $select, ...query } = params.query ?? {}

        return { query, filters: { $skip, $sort, $limit, $select } }
    }

    // Every record the query matches, in the order they were created
    private matching(query: Query): T[] {
        const rows = this.db.query<Row, []>(`SELECT data FROM ${this.table} ORDER BY rowid`).all()
        const records = rows.map(row => JSON.parse(row.data) as T)

        return Object.keys(query).length === 0 ? records : records.filter(sift(query))
    }

    // The record with the ID, if the query matches it too
    private read(id: Id, query: Query): T {
        const row = this.db.query<Row, [string]>(`SELECT data FROM ${this.table} WHERE id = ?`).get(String(id))
        const record = row ? (JSON.parse(row.data) as T) : undefined

        if (!record || !sift(query)(record)) throw new NotFound(`No record found for id '${id}'`)

        return record
    }

    private write(record: T): T {
        this.db.query(`UPDATE ${this.table} SET data = ? WHERE id = ?`).run(JSON.stringify(record), record.id)

        return record
    }
}
