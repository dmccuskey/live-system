import { describe, expect, test } from 'bun:test'
import { MemoryRecordSource } from 'live-system/core'

interface Item {
    id: string
    name: string
    count: number
}

const first: Item = { id: 'a', name: 'first', count: 1 }
const second: Item = { id: 'b', name: 'second', count: 2 }

describe('reading', () => {
    test('find() returns every record', async () => {
        const source = new MemoryRecordSource<Item>([first, second])

        expect(await source.find()).toEqual([first, second])
    })

    test('find() returns an empty array when there are none', async () => {
        expect(await new MemoryRecordSource<Item>().find()).toEqual([])
    })

    test('get() returns one record', async () => {
        const source = new MemoryRecordSource<Item>([first, second])

        expect(await source.get('b')).toEqual(second)
    })

    test('get() rejects when the record does not exist', async () => {
        const source = new MemoryRecordSource<Item>([first])

        expect(source.get('missing')).rejects.toThrow("No record with the ID 'missing'")
    })

    test('records are handed out as copies', async () => {
        const source = new MemoryRecordSource<Item>([first])

        const record = await source.get('a')
        record.name = 'changed outside'
        const [found] = await source.find()
        found!.count = 99

        expect(await source.get('a')).toEqual(first)
    })

    test('the records given to the constructor are copied', async () => {
        const record = { ...first }
        const source = new MemoryRecordSource<Item>([record])

        record.name = 'changed outside'

        expect(await source.get('a')).toEqual(first)
    })
})

describe('writing', () => {
    test('create() assigns an ID when none is given', async () => {
        const source = new MemoryRecordSource<Item>()

        const created = await source.create({ name: 'new', count: 0 })

        expect(created.id).toBeString()
        expect(created.id).not.toBe('')
        expect(await source.get(created.id)).toEqual(created)
    })

    test('create() assigns a different ID each time', async () => {
        const source = new MemoryRecordSource<Item>()

        const one = await source.create({ name: 'one', count: 0 })
        const two = await source.create({ name: 'two', count: 0 })

        expect(one.id).not.toBe(two.id)
    })

    test('create() keeps an ID that is given', async () => {
        const source = new MemoryRecordSource<Item>()

        expect(await source.create(first)).toEqual(first)
        expect(await source.find()).toEqual([first])
    })

    test('create() rejects an ID that exists', async () => {
        const source = new MemoryRecordSource<Item>([first])

        expect(source.create(first)).rejects.toThrow("A record with the ID 'a' already exists")
    })

    test('update() replaces the record', async () => {
        const source = new MemoryRecordSource<Item>([first])

        const updated = await source.update('a', { id: 'a', name: 'replaced', count: 5 })

        expect(updated).toEqual({ id: 'a', name: 'replaced', count: 5 })
        expect(await source.get('a')).toEqual(updated)
    })

    test('update() keeps the ID it was called with', async () => {
        const source = new MemoryRecordSource<Item>([first])

        const updated = await source.update('a', { id: 'other', name: 'replaced', count: 5 })

        expect(updated.id).toBe('a')
        expect(await source.find()).toHaveLength(1)
    })

    test('patch() changes only the fields given', async () => {
        const source = new MemoryRecordSource<Item>([first])

        const patched = await source.patch('a', { count: 7 })

        expect(patched).toEqual({ id: 'a', name: 'first', count: 7 })
        expect(await source.get('a')).toEqual(patched)
    })

    test('remove() removes the record and returns it', async () => {
        const source = new MemoryRecordSource<Item>([first, second])

        expect(await source.remove('a')).toEqual(first)
        expect(await source.find()).toEqual([second])
    })

    test('update(), patch() and remove() reject for a record that does not exist', async () => {
        const source = new MemoryRecordSource<Item>()

        expect(source.update('a', first)).rejects.toThrow("No record with the ID 'a'")
        expect(source.patch('a', { count: 1 })).rejects.toThrow("No record with the ID 'a'")
        expect(source.remove('a')).rejects.toThrow("No record with the ID 'a'")
    })
})

describe('change events', () => {
    function listen(source: MemoryRecordSource<Item>) {
        const events: [string, Item][] = []

        source.onCreated(record => events.push(['created', record]))
        source.onUpdated(record => events.push(['updated', record]))
        source.onPatched(record => events.push(['patched', record]))
        source.onRemoved(record => events.push(['removed', record]))

        return events
    }

    test('each change emits its own event, with the record', async () => {
        const source = new MemoryRecordSource<Item>()
        const events = listen(source)

        await source.create(first)
        await source.update('a', { id: 'a', name: 'replaced', count: 5 })
        await source.patch('a', { count: 6 })
        await source.remove('a')

        expect(events).toEqual([
            ['created', first],
            ['updated', { id: 'a', name: 'replaced', count: 5 }],
            ['patched', { id: 'a', name: 'replaced', count: 6 }],
            ['removed', { id: 'a', name: 'replaced', count: 6 }]
        ])
    })

    test('a failed change emits nothing', async () => {
        const source = new MemoryRecordSource<Item>([first])
        const events = listen(source)

        await source.create(first).catch(() => {})
        await source.patch('missing', { count: 1 }).catch(() => {})
        await source.remove('missing').catch(() => {})

        expect(events).toEqual([])
    })

    test('reading emits nothing', async () => {
        const source = new MemoryRecordSource<Item>([first])
        const events = listen(source)

        await source.find()
        await source.get('a')

        expect(events).toEqual([])
    })

    test('the function returned ends the subscription', async () => {
        const source = new MemoryRecordSource<Item>()
        const seen: Item[] = []
        const unsubscribe = source.onCreated(record => seen.push(record))

        await source.create(first)
        unsubscribe()
        unsubscribe()
        await source.create(second)

        expect(seen).toEqual([first])
    })

    test('the same listener subscribed twice is two subscriptions', async () => {
        const source = new MemoryRecordSource<Item>()
        let calls = 0
        const listener = () => (calls += 1)
        const unsubscribe = source.onCreated(listener)
        source.onCreated(listener)

        await source.create(first)
        unsubscribe()
        await source.create(second)

        expect(calls).toBe(3)
    })

    test('a listener cannot change the stored record', async () => {
        const source = new MemoryRecordSource<Item>()
        source.onCreated(record => (record.name = 'changed by a listener'))

        await source.create(first)

        expect(await source.get('a')).toEqual(first)
    })
})
