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

/** The records a query finds, from the service without pagination. */
const list = (query?: Record<string, unknown>) => items.find({ query, paginate: false })

const createFive = async () => {
    await items.create({ id: 'a', name: 'A', size: 3, tags: { color: 'red' } })
    await items.create({ id: 'b', name: 'B', size: 1, tags: { color: 'blue' } })
    await items.create({ id: 'c', name: 'C', size: 2, tags: { color: 'red' } })
    await items.create({ id: 'd', name: 'D', size: 5 })
    await items.create({ id: 'e', name: 'E', size: 4, tags: { color: 'blue' } })
}

const ids = (records: Item[]) => records.map(item => item.id)

test('a table name must be a plain identifier', () => {
    expect(() => new SqliteService(db, 'items; DROP TABLE items')).toThrow('Not a table name')
})

test('a second service on the same table sees the same records', async () => {
    await items.create({ id: 'a', name: 'A' })

    expect(await new SqliteService<Item>(db, 'items').find({ paginate: false })).toEqual([{ id: 'a', name: 'A' }])
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

    test('rejects an array, as a Feathers adapter does unless `multi` allows it', async () => {
        expect(items.create([{ id: 'a', name: 'A' }])).rejects.toMatchObject({ name: 'MethodNotAllowed', code: 405 })
        expect(await list()).toEqual([])
    })

    test('creates each record of an array where `multi` allows it', async () => {
        const many = new SqliteService<Item>(db, 'items', { multi: ['create'] })

        expect(
            await many.create([
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
            ]),
        ).toEqual([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
        ])
        expect(ids(await list())).toEqual(['a', 'b'])
    })

    test('rejects an id that exists, and keeps the first record', async () => {
        await items.create({ id: 'a', name: 'A' })

        expect(items.create({ id: 'a', name: 'Other' })).rejects.toMatchObject({ name: 'Conflict', code: 409 })
        expect(await items.get('a')).toEqual({ id: 'a', name: 'A' })
    })
})

describe('find', () => {
    test('returns an empty array when there are no records', async () => {
        expect(await list()).toEqual([])
    })

    test('returns every record, in the order they were created', async () => {
        await items.create({ id: 'b', name: 'B' })
        await items.create({ id: 'a', name: 'A' })

        expect(ids(await list())).toEqual(['b', 'a'])
    })

    test('narrows by the fields of a query', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })
        await items.create({ id: 'b', name: 'B', size: 2 })
        await items.create({ id: 'c', name: 'C', size: 2 })

        expect(ids(await list({ size: 2 }))).toEqual(['b', 'c'])
        expect(await list({ size: 2, name: 'A' })).toEqual([])
    })

    test("narrows by Feathers' operators, and by a nested field", async () => {
        await createFive()

        expect(ids(await list({ size: { $gt: 3 } }))).toEqual(['d', 'e'])
        expect(ids(await list({ size: { $gte: 2, $lt: 4 } }))).toEqual(['a', 'c'])
        expect(ids(await list({ name: { $in: ['A', 'E'] } }))).toEqual(['a', 'e'])
        expect(ids(await list({ name: { $nin: ['A', 'E'] } }))).toEqual(['b', 'c', 'd'])
        expect(ids(await list({ size: { $ne: 1 } }))).toEqual(['a', 'c', 'd', 'e'])
        expect(ids(await list({ $or: [{ name: 'A' }, { size: 5 }] }))).toEqual(['a', 'd'])
        expect(ids(await list({ 'tags.color': 'blue' }))).toEqual(['b', 'e'])
    })

    test('takes `$limit` and `$skip`', async () => {
        await createFive()

        expect(ids(await list({ $limit: 2 }))).toEqual(['a', 'b'])
        expect(ids(await list({ $skip: 3 }))).toEqual(['d', 'e'])
        expect(ids(await list({ $limit: 2, $skip: 2 }))).toEqual(['c', 'd'])
        expect(ids(await list({ $limit: 25 }))).toEqual(['a', 'b', 'c', 'd', 'e'])
        expect(await list({ $limit: 0 })).toEqual([])
    })

    test('takes `$limit` beside a field, counted after the narrowing', async () => {
        await createFive()

        expect(ids(await list({ 'tags.color': 'red', $limit: 1, $skip: 1 }))).toEqual(['c'])
    })

    test('orders by `$sort`', async () => {
        await createFive()

        expect(ids(await list({ $sort: { size: 1 } }))).toEqual(['b', 'c', 'a', 'e', 'd'])
        expect(ids(await list({ $sort: { size: -1 }, $limit: 2 }))).toEqual(['d', 'e'])
    })

    test('keeps only the fields of `$select`, and the id', async () => {
        await createFive()

        expect(await list({ $select: ['name'], $limit: 2 })).toEqual([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
        ] as Item[])
    })

    test('refuses a query parameter it does not know', async () => {
        expect(list({ $nope: 1 })).rejects.toMatchObject({ name: 'BadRequest', code: 400 })
        expect(list({ size: { $nope: 1 } })).rejects.toMatchObject({ name: 'BadRequest', code: 400 })
    })
})

describe('find, with pagination', () => {
    let paged: SqliteService<Item>

    beforeEach(async () => {
        paged = new SqliteService<Item>(db, 'items', { paginate: { default: 2, max: 3 } })
        await createFive()
    })

    test('answers a page: its records, and how many there are in all', async () => {
        const page = await paged.find()

        expect(ids(page.data)).toEqual(['a', 'b'])
        expect(page).toMatchObject({ total: 5, limit: 2, skip: 0 })
    })

    test('takes `$limit` up to its maximum, and `$skip`', async () => {
        expect(await paged.find({ query: { $limit: 3, $skip: 3 } })).toMatchObject({ total: 5, limit: 3, skip: 3 })
        expect(ids((await paged.find({ query: { $limit: 3, $skip: 3 } })).data)).toEqual(['d', 'e'])
        expect(await paged.find({ query: { $limit: 25 } })).toMatchObject({ total: 5, limit: 3 })
    })

    test('counts with a `$limit` of 0', async () => {
        expect(await paged.find({ query: { $limit: 0 } })).toEqual({ total: 5, limit: 0, skip: 0, data: [] })
    })

    test('counts what the query matches, not the page', async () => {
        const page = await paged.find({ query: { 'tags.color': 'red', $limit: 1 } })

        expect(page).toMatchObject({ total: 2, limit: 1 })
        expect(ids(page.data)).toEqual(['a'])
    })

    test('answers an array to a call that turns pagination off', async () => {
        expect(ids(await paged.find({ paginate: false }))).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
})

describe('get', () => {
    test('rejects with NotFound for a missing id', async () => {
        expect(items.get('missing')).rejects.toMatchObject({ name: 'NotFound', code: 404 })
    })

    test('rejects with NotFound for a record its query does not match', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })

        expect(await items.get('a', { query: { size: 1 } })).toEqual({ id: 'a', name: 'A', size: 1 })
        expect(items.get('a', { query: { size: 2 } })).rejects.toMatchObject({ name: 'NotFound' })
    })

    test('keeps only the fields of `$select`, and the id', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })

        expect(await items.get('a', { query: { $select: ['size'] } })).toEqual({ id: 'a', size: 1 } as Item)
    })
})

describe('update', () => {
    test('replaces the record and keeps its id', async () => {
        await items.create({ id: 'a', name: 'A', size: 1 })

        expect(await items.update('a', { id: 'other', name: 'New' })).toEqual({ id: 'a', name: 'New' })
        expect(await list()).toEqual([{ id: 'a', name: 'New' }])
    })

    test('rejects with NotFound for a missing id', async () => {
        expect(items.update('missing', { id: 'missing', name: 'A' })).rejects.toMatchObject({ name: 'NotFound' })
        expect(await list()).toEqual([])
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
        expect(await list()).toEqual([])
    })

    test('rejects with NotFound for a missing id', async () => {
        expect(items.remove('missing')).rejects.toMatchObject({ name: 'NotFound' })
    })
})

describe('many records at once', () => {
    test('a patch or a remove with no id is refused, unless `multi` allows it', async () => {
        await createFive()

        expect(items.patch(null, { size: 0 })).rejects.toMatchObject({ name: 'MethodNotAllowed', code: 405 })
        expect(items.remove(null)).rejects.toMatchObject({ name: 'MethodNotAllowed', code: 405 })
        expect(await list({ size: 0 })).toEqual([])
        expect(await list()).toHaveLength(5)
    })

    test('with `multi`, a patch and a remove take every record the query matches', async () => {
        const many = new SqliteService<Item>(db, 'items', { multi: true })
        await createFive()

        expect(ids(await many.patch(null, { size: 0 }, { query: { 'tags.color': 'red' } }))).toEqual(['a', 'c'])
        expect(ids(await list({ size: 0 }))).toEqual(['a', 'c'])

        expect(ids(await many.remove(null, { query: { size: 0 } }))).toEqual(['a', 'c'])
        expect(ids(await list())).toEqual(['b', 'd', 'e'])
    })
})
