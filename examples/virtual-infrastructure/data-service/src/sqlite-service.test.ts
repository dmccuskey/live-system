import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { SqliteService } from './sqlite-service.ts'

interface Item {
    id: string
    name: string
    size?: number
    tags?: { color: string }
}

let db: Database
let items: SqliteService<Item>

beforeEach(() => {
    db = new Database(':memory:')
    items = new SqliteService<Item>(db, 'items')
})

test('a table name must be a plain identifier', () => {
    expect(() => new SqliteService(db, 'items; DROP TABLE items')).toThrow('Not a table name')
})

test('a second service on the same table sees the same records', async () => {
    await items.create({ id: 'a', name: 'A' })

    expect(await new SqliteService<Item>(db, 'items').find()).toEqual([{ id: 'a', name: 'A' }])
})

describe('create', () => {
    test('stores the record and returns it, nested fields included', async () => {
        const record = { id: 'a', name: 'A', tags: { color: 'red' } }

        expect(await items.create(record)).toEqual(record)
        expect(await items.get('a')).toEqual(record)
    })

    test('rejects a record without a string id', async () => {
        expect(items.create({ name: 'A' } as Item)).rejects.toMatchObject({ name: 'BadRequest', code: 400 })
    })

    test('rejects an array', async () => {
        expect(items.create([{ id: 'a', name: 'A' }] as unknown as Item)).rejects.toMatchObject({ name: 'BadRequest' })
    })

    test('rejects an id that exists, and keeps the first record', async () => {
        await items.create({ id: 'a', name: 'A' })

        expect(items.create({ id: 'a', name: 'Other' })).rejects.toMatchObject({ name: 'Conflict', code: 409 })
        expect(await items.get('a')).toEqual({ id: 'a', name: 'A' })
    })
})

describe('find', () => {
    test('returns an empty array when there are no records', async () => {
        expect(await items.find()).toEqual([])
    })

    test('returns every record, in the order they were created', async () => {
        await items.create({ id: 'b', name: 'B' })
        await items.create({ id: 'a', name: 'A' })

        expect((await items.find()).map(item => item.id)).toEqual(['b', 'a'])
    })

    test('narrows by the fields of a query', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })
        await items.create({ id: 'b', name: 'B', size: 2 })
        await items.create({ id: 'c', name: 'C', size: 2 })

        expect((await items.find({ query: { size: 2 } })).map(item => item.id)).toEqual(['b', 'c'])
        expect(await items.find({ query: { size: 2, name: 'A' } })).toEqual([])
    })
})

describe('get', () => {
    test('rejects with NotFound for a missing id', async () => {
        expect(items.get('missing')).rejects.toMatchObject({ name: 'NotFound', code: 404 })
    })
})

describe('update', () => {
    test('replaces the record and keeps its id', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })

        expect(await items.update('a', { id: 'other', name: 'New' })).toEqual({ id: 'a', name: 'New' })
        expect(await items.find()).toEqual([{ id: 'a', name: 'New' }])
    })

    test('rejects with NotFound for a missing id', async () => {
        expect(items.update('missing', { id: 'missing', name: 'A' })).rejects.toMatchObject({ name: 'NotFound' })
        expect(await items.find()).toEqual([])
    })
})

describe('patch', () => {
    test('merges the given fields and keeps the rest', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })

        expect(await items.patch('a', { size: 2 })).toEqual({ id: 'a', name: 'A', size: 2 })
        expect(await items.get('a')).toEqual({ id: 'a', name: 'A', size: 2 })
    })

    test('keeps the id', async () => {
        await items.create({ id: 'a', name: 'A' })

        expect(await items.patch('a', { id: 'other' })).toEqual({ id: 'a', name: 'A' })
    })

    test('rejects with NotFound for a missing id', async () => {
        expect(items.patch('missing', { size: 2 })).rejects.toMatchObject({ name: 'NotFound' })
    })
})

describe('remove', () => {
    test('removes the record and returns it', async () => {
        await items.create({ id: 'a', name: 'A' })

        expect(await items.remove('a')).toEqual({ id: 'a', name: 'A' })
        expect(await items.find()).toEqual([])
    })

    test('rejects with NotFound for a missing id', async () => {
        expect(items.remove('missing')).rejects.toMatchObject({ name: 'NotFound' })
    })
})
