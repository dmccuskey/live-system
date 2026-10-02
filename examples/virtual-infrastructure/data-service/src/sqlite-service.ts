// SqliteService: a Feathers service that keeps one kind of record in a SQLite table.
import type { Database } from 'bun:sqlite'
import { BadRequest, Conflict, NotFound } from '@feathersjs/errors'

export interface StoredRecord {
    id: string
}

export interface FindParams {
    query?: Record<string, unknown>
}

interface Row {
    data: string
}

/**
 * The records of one table, each stored whole as JSON beside its ID, so a
 * record gains a field without a change to the table. `find` returns every
 * record as an array, narrowed by a query of top-level fields to equal.
 * It does not assign IDs: a create hook does.
 */
export class SqliteService<T extends StoredRecord = StoredRecord> {
    // Not `#` fields: Feathers calls a service through an object that inherits from it
    private readonly db: Database
    private readonly table: string

    constructor(db: Database, table: string) {
        if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Not a table name: "${table}"`)

        this.db = db
        this.table = table
        db.run(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`)
    }

    async find(params?: FindParams): Promise<T[]> {
        const rows = this.db.query<Row, []>(`SELECT data FROM ${this.table} ORDER BY rowid`).all()
        const records = rows.map(row => JSON.parse(row.data) as T)
        const query = Object.entries(params?.query ?? {})

        return records.filter(record =>
            query.every(([field, value]) => (record as Record<string, unknown>)[field] === value),
        )
    }

    async get(id: string): Promise<T> {
        const row = this.db.query<Row, [string]>(`SELECT data FROM ${this.table} WHERE id = ?`).get(String(id))

        if (!row) throw new NotFound(`No record found for id '${id}'`)

        return JSON.parse(row.data) as T
    }

    async create(data: T): Promise<T> {
        if (Array.isArray(data)) throw new BadRequest('Records are created one at a time')
        if (typeof data?.id !== 'string' || data.id === '') throw new BadRequest('A record needs a string id')

        const added = this.db
            .query(`INSERT OR IGNORE INTO ${this.table} (id, data) VALUES (?, ?)`)
            .run(data.id, JSON.stringify(data))

        if (added.changes === 0) throw new Conflict(`A record with id '${data.id}' already exists`)

        return data
    }

    /** Replaces the record. Its ID stays. */
    async update(id: string, data: T): Promise<T> {
        await this.get(id)

        return this.write({ ...data, id: String(id) })
    }

    /** Merges the top-level fields of `data` into the record. Its ID stays. */
    async patch(id: string, data: Partial<T>): Promise<T> {
        const record = await this.get(id)

        return this.write({ ...record, ...data, id: record.id })
    }

    async remove(id: string): Promise<T> {
        const record = await this.get(id)

        this.db.query(`DELETE FROM ${this.table} WHERE id = ?`).run(record.id)

        return record
    }

    private write(record: T): T {
        this.db.query(`UPDATE ${this.table} SET data = ? WHERE id = ?`).run(JSON.stringify(record), record.id)

        return record
    }
}
