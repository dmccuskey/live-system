import { describe, expect, test } from 'bun:test'
import {
    FeathersRecordSource,
    type FeathersRecordSourceOptions,
    type FeathersServiceLike,
    type RecordConversion,
} from './record-source.ts'

interface Item {
    id: string
    name: string
}

type Listener = (record: any) => void

/** A service that records its calls and answers with what the test gives it. */
class FakeService implements FeathersServiceLike {
    calls: unknown[][] = []
    result: unknown = undefined
    /** Answers for the next calls, one each, before `result`. */
    results: unknown[] = []
    listeners = new Map<string, Listener[]>()

    async find(params?: unknown) {
        return this.#call('find', params)
    }
    async get(id: string) {
        return this.#call('get', id)
    }
    async create(data: unknown) {
        return this.#call('create', data)
    }
    async update(id: string, data: unknown) {
        return this.#call('update', id, data)
    }
    async patch(id: string, data: unknown) {
        return this.#call('patch', id, data)
    }
    async remove(id: string) {
        return this.#call('remove', id)
    }
    on(event: string, listener: Listener) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    }
    off(event: string, listener: Listener) {
        this.listeners.set(
            event,
            (this.listeners.get(event) ?? []).filter(entry => entry !== listener),
        )
    }
    emit(event: string, record: unknown) {
        for (const listener of this.listeners.get(event) ?? []) listener(record)
    }

    #call(...call: unknown[]) {
        this.calls.push(call)

        if (this.results.length > 0) return this.results.shift()
        if (this.result instanceof Error) throw this.result

        return this.result
    }
}

const setup = (options?: FeathersRecordSourceOptions<Item>) => {
    const service = new FakeService()

    return { service, source: new FeathersRecordSource<Item>(service, options) }
}

describe('find', () => {
    test('returns an array as it is', async () => {
        const { service, source } = setup()
        service.result = [{ id: 'a', name: 'A' }]

        expect(await source.find()).toEqual([{ id: 'a', name: 'A' }])
    })

    test('returns the records of a page', async () => {
        const { service, source } = setup()
        service.result = { total: 1, limit: 10, skip: 0, data: [{ id: 'a', name: 'A' }] }

        expect(await source.find()).toEqual([{ id: 'a', name: 'A' }])
    })

    test('reads every page of a paginated service', async () => {
        const { service, source } = setup()
        service.results = [
            { total: 5, limit: 2, skip: 0, data: [{ id: 'a' }, { id: 'b' }] },
            { total: 5, limit: 2, skip: 2, data: [{ id: 'c' }, { id: 'd' }] },
            { total: 5, limit: 2, skip: 4, data: [{ id: 'e' }] },
        ]

        expect((await source.find()).map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
        expect(service.calls).toEqual([
            ['find', undefined],
            ['find', { query: { $skip: 2 } }],
            ['find', { query: { $skip: 4 } }],
        ])
    })

    test('keeps the fixed query on every page', async () => {
        const { service, source } = setup({ query: { kind: 'x' } })
        service.results = [
            { total: 2, limit: 1, skip: 0, data: [{ id: 'a' }] },
            { total: 2, limit: 1, skip: 1, data: [{ id: 'b' }] },
        ]
        await source.find()

        expect(service.calls).toEqual([
            ['find', { query: { kind: 'x' } }],
            ['find', { query: { kind: 'x', $skip: 1 } }],
        ])
    })

    test('reads on from the $skip of the fixed query', async () => {
        const { service, source } = setup({ query: { $skip: 1 } })
        service.results = [
            { total: 3, limit: 1, skip: 1, data: [{ id: 'b' }] },
            { total: 3, limit: 1, skip: 2, data: [{ id: 'c' }] },
        ]

        expect((await source.find()).map(item => item.id)).toEqual(['b', 'c'])
        expect(service.calls).toEqual([
            ['find', { query: { $skip: 1 } }],
            ['find', { query: { $skip: 2 } }],
        ])
    })

    test('returns the one page of a query with its own $limit', async () => {
        const { service, source } = setup({ query: { $limit: 2 } })
        service.result = { total: 5, limit: 2, skip: 0, data: [{ id: 'a' }, { id: 'b' }] }

        expect((await source.find()).map(item => item.id)).toEqual(['a', 'b'])
        expect(service.calls).toHaveLength(1)
    })

    test('stops at an empty page, though the count says more', async () => {
        const { service, source } = setup()
        service.results = [
            { total: 3, limit: 2, skip: 0, data: [{ id: 'a' }, { id: 'b' }] },
            { total: 3, limit: 2, skip: 2, data: [] },
        ]

        expect((await source.find()).map(item => item.id)).toEqual(['a', 'b'])
        expect(service.calls).toHaveLength(2)
    })

    test('without a count, reads until a page is not full', async () => {
        const { service, source } = setup()
        service.results = [
            { limit: 2, skip: 0, data: [{ id: 'a' }, { id: 'b' }] },
            { limit: 2, skip: 2, data: [{ id: 'c' }] },
        ]

        expect((await source.find()).map(item => item.id)).toEqual(['a', 'b', 'c'])
        expect(service.calls).toHaveLength(2)
    })

    test('converts the ID field on every page', async () => {
        const { service, source } = setup({ idField: '_id' })
        service.results = [
            { total: 2, limit: 1, skip: 0, data: [{ _id: 'a', name: 'A' }] },
            { total: 2, limit: 1, skip: 1, data: [{ _id: 'b', name: 'B' }] },
        ]

        expect(await source.find()).toEqual([
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
        ])
    })

    test('returns a single record as an array of one', async () => {
        const { service, source } = setup()
        service.result = { id: 'a', name: 'A' }

        expect(await source.find()).toEqual([{ id: 'a', name: 'A' }])
    })

    test('passes no params without a query', async () => {
        const { service, source } = setup()
        service.result = []
        await source.find()

        expect(service.calls).toEqual([['find', undefined]])
    })

    test('passes the fixed query', async () => {
        const { service, source } = setup({ query: { kind: 'x' } })
        service.result = []
        await source.find()

        expect(service.calls).toEqual([['find', { query: { kind: 'x' } }]])
    })
})

describe('calls', () => {
    test('each goes to the service method of its name', async () => {
        const { service, source } = setup()
        service.result = { id: 'a', name: 'A' }

        expect(await source.get('a')).toEqual({ id: 'a', name: 'A' })
        expect(await source.create({ name: 'A' })).toEqual({ id: 'a', name: 'A' })
        expect(await source.update('a', { id: 'a', name: 'B' })).toEqual({ id: 'a', name: 'A' })
        expect(await source.patch('a', { name: 'C' })).toEqual({ id: 'a', name: 'A' })
        expect(await source.remove('a')).toEqual({ id: 'a', name: 'A' })

        expect(service.calls).toEqual([
            ['get', 'a'],
            ['create', { name: 'A' }],
            ['update', 'a', { id: 'a', name: 'B' }],
            ['patch', 'a', { name: 'C' }],
            ['remove', 'a'],
        ])
    })

    test("a failed call rejects with the service's own error", async () => {
        const { service, source } = setup()
        const error = Object.assign(new Error('No record'), { name: 'NotFound', code: 404 })
        service.result = error

        expect(source.get('missing')).rejects.toBe(error)
    })

    test("isNotFound() tells Feathers' NotFound from any other failure", () => {
        const { source } = setup()

        expect(source.isNotFound(Object.assign(new Error('No record'), { name: 'NotFound', code: 404 }))).toBe(true)
        expect(source.isNotFound(Object.assign(new Error('Bad'), { name: 'BadRequest', code: 400 }))).toBe(false)
        expect(source.isNotFound(new Error('operation has timed out'))).toBe(false)
        expect(source.isNotFound(undefined)).toBe(false)
    })
})

describe('listeners', () => {
    test.each([
        ['onCreated', 'created'],
        ['onUpdated', 'updated'],
        ['onPatched', 'patched'],
        ['onRemoved', 'removed'],
    ] as const)('%s hears the %s event, and no other', (method, event) => {
        const { service, source } = setup()
        const heard: Item[] = []
        source[method](record => heard.push(record))

        for (const name of ['created', 'updated', 'patched', 'removed']) {
            service.emit(name, { id: name, name })
        }

        expect(heard).toEqual([{ id: event, name: event }])
    })

    test('an unsubscribed listener hears nothing more', () => {
        const { service, source } = setup()
        const heard: Item[] = []
        const unsubscribe = source.onCreated(record => heard.push(record))

        service.emit('created', { id: 'a', name: 'A' })
        unsubscribe()
        service.emit('created', { id: 'b', name: 'B' })

        expect(heard).toEqual([{ id: 'a', name: 'A' }])
        expect(service.listeners.get('created')).toEqual([])
    })

    test('the same function subscribed twice is two subscriptions', () => {
        const { service, source } = setup()
        const heard: Item[] = []
        const listener = (record: Item) => heard.push(record)
        const first = source.onCreated(listener)
        source.onCreated(listener)

        first()
        service.emit('created', { id: 'a', name: 'A' })

        expect(heard).toHaveLength(1)
    })
})

describe('onReconnected', () => {
    test('subscribes through the option, and its unsubscribe ends it', () => {
        const listeners = new Set<() => void>()
        const { source } = setup({
            onReconnected: listener => {
                listeners.add(listener)

                return () => listeners.delete(listener)
            },
        })
        let calls = 0
        const unsubscribe = source.onReconnected(() => (calls += 1))

        for (const listener of listeners) listener()
        unsubscribe()

        expect(calls).toBe(1)
        expect(listeners.size).toBe(0)
    })

    test('without the option, a listener is never called and can be unsubscribed', () => {
        const { source } = setup()

        expect(() => source.onReconnected(() => {})()).not.toThrow()
    })
})

describe('idField', () => {
    test('records come back with `id`', async () => {
        const { service, source } = setup({ idField: '_id' })
        service.result = [{ _id: 'a', name: 'A' }]

        expect(await source.find()).toEqual([{ id: 'a', name: 'A' }])

        service.result = { _id: 'a', name: 'A' }

        expect(await source.get('a')).toEqual({ id: 'a', name: 'A' })
    })

    test("records go out with the backend's field", async () => {
        const { service, source } = setup({ idField: '_id' })
        service.result = { _id: 'a', name: 'A' }

        await source.create({ id: 'a', name: 'A' })
        await source.create({ name: 'A' })
        await source.update('a', { id: 'a', name: 'B' })
        await source.patch('a', { name: 'C' })

        expect(service.calls).toEqual([
            ['create', { _id: 'a', name: 'A' }],
            ['create', { name: 'A' }],
            ['update', 'a', { _id: 'a', name: 'B' }],
            ['patch', 'a', { name: 'C' }],
        ])
    })

    test('listeners hear records with `id`', () => {
        const { service, source } = setup({ idField: '_id' })
        const heard: Item[] = []
        source.onPatched(record => heard.push(record))

        service.emit('patched', { _id: 'a', name: 'A' })

        expect(heard).toEqual([{ id: 'a', name: 'A' }])
    })

    test('a record with an `id` of its own beside the ID field is refused, not robbed of it', async () => {
        const { service, source } = setup({ idField: '_id' })
        service.result = [{ _id: 'a', id: 'its own', name: 'A' }]

        expect(source.find()).rejects.toThrow(/field `id` of its own beside its ID field `_id`.*`convert`/)

        service.result = { _id: 'a', id: 'its own', name: 'A' }

        expect(source.get('a')).rejects.toThrow(/`convert`/)
    })
})

describe('number IDs', () => {
    test('a number ID comes back as a string', async () => {
        const { service, source } = setup()
        service.result = [{ id: 5, name: 'A' }]

        expect(await source.find()).toEqual([{ id: '5', name: 'A' }])

        service.result = { id: 5, name: 'A' }

        expect(await source.get('5')).toEqual({ id: '5', name: 'A' })
        expect(await source.create({ name: 'A' })).toEqual({ id: '5', name: 'A' })
        expect(await source.patch('5', { name: 'A' })).toEqual({ id: '5', name: 'A' })
        expect(await source.remove('5')).toEqual({ id: '5', name: 'A' })
    })

    test('on every page', async () => {
        const { service, source } = setup()
        service.results = [
            { total: 2, limit: 1, skip: 0, data: [{ id: 1, name: 'A' }] },
            { total: 2, limit: 1, skip: 1, data: [{ id: 2, name: 'B' }] },
        ]

        expect((await source.find()).map(item => item.id)).toEqual(['1', '2'])
    })

    test('with another ID field too', async () => {
        const { service, source } = setup({ idField: '_id' })
        service.result = { _id: 5, name: 'A' }

        expect(await source.get('5')).toEqual({ id: '5', name: 'A' })
    })

    test('a listener hears it as a string', () => {
        const { service, source } = setup()
        const heard: Item[] = []
        source.onCreated(record => heard.push(record))

        service.emit('created', { id: 5, name: 'A' })

        expect(heard).toEqual([{ id: '5', name: 'A' }])
    })

    test('the ID goes to the service as the string it was given', async () => {
        const { service, source } = setup()
        service.result = { id: 5, name: 'A' }
        await source.get('5')
        await source.patch('5', { name: 'B' })

        expect(service.calls).toEqual([
            ['get', '5'],
            ['patch', '5', { name: 'B' }],
        ])
    })

    test('a record with a string ID is handed on as it is', async () => {
        const { service, source } = setup()
        const record = { id: 'a', name: 'A' }
        service.result = record

        expect(await source.get('a')).toBe(record)
    })

    test('a record with no ID is left without one', async () => {
        const { service, source } = setup()
        service.result = [{ name: 'A' }, { id: null, name: 'B' }]

        expect(await source.find()).toEqual([{ name: 'A' }, { id: null, name: 'B' }] as unknown as Item[])
    })
})

describe('convert', () => {
    /** The record as the backend has it, beside an `id` to find it by. */
    interface Envelope {
        id: string
        raw: Record<string, unknown>
    }

    const envelope: RecordConversion<Envelope> = {
        read: backend => ({ id: String(backend._id), raw: backend }),
        write: data => data.raw ?? {},
    }

    const setupEnvelope = (options?: FeathersRecordSourceOptions<Envelope>) => {
        const service = new FakeService()

        return { service, source: new FeathersRecordSource<Envelope>(service, { convert: envelope, ...options }) }
    }

    test('reads every record that comes back from a call', async () => {
        const { service, source } = setupEnvelope()
        const raw = { _id: 5, id: 'its own', name: 'A' }
        const record = { id: '5', raw }

        service.result = [raw]

        expect(await source.find()).toEqual([record])

        service.result = raw

        expect(await source.get('5')).toEqual(record)
        expect(await source.create({ raw: { name: 'A' } })).toEqual(record)
        expect(await source.update('5', record)).toEqual(record)
        expect(await source.patch('5', { raw: { name: 'A' } })).toEqual(record)
        expect(await source.remove('5')).toEqual(record)
    })

    test('reads every page', async () => {
        const { service, source } = setupEnvelope()
        service.results = [
            { total: 2, limit: 1, skip: 0, data: [{ _id: 1 }] },
            { total: 2, limit: 1, skip: 1, data: [{ _id: 2 }] },
        ]

        expect(await source.find()).toEqual([
            { id: '1', raw: { _id: 1 } },
            { id: '2', raw: { _id: 2 } },
        ])
    })

    test('reads the record of each change event', () => {
        const { service, source } = setupEnvelope()
        const heard: Envelope[] = []
        source.onCreated(record => heard.push(record))
        source.onUpdated(record => heard.push(record))
        source.onPatched(record => heard.push(record))
        source.onRemoved(record => heard.push(record))

        for (const event of ['created', 'updated', 'patched', 'removed']) service.emit(event, { _id: 5, event })

        expect(heard).toEqual([
            { id: '5', raw: { _id: 5, event: 'created' } },
            { id: '5', raw: { _id: 5, event: 'updated' } },
            { id: '5', raw: { _id: 5, event: 'patched' } },
            { id: '5', raw: { _id: 5, event: 'removed' } },
        ])
    })

    test('writes what a create, an update and a patch send', async () => {
        const { service, source } = setupEnvelope()
        service.result = { _id: 5 }

        await source.create({ raw: { id: 'its own', name: 'A' } })
        await source.update('5', { id: '5', raw: { _id: 5, name: 'B' } })
        await source.patch('5', { raw: { name: 'C' } })

        expect(service.calls).toEqual([
            ['create', { id: 'its own', name: 'A' }],
            ['update', '5', { _id: 5, name: 'B' }],
            ['patch', '5', { name: 'C' }],
        ])
    })

    test('keeps the fixed query', async () => {
        const { service, source } = setupEnvelope({ query: { kind: 'x' } })
        service.result = []
        await source.find()

        expect(service.calls).toEqual([['find', { query: { kind: 'x' } }]])
    })

    test('is refused together with `idField`', () => {
        expect(
            () => new FeathersRecordSource<Envelope>(new FakeService(), { convert: envelope, idField: '_id' }),
        ).toThrow(/`convert` or `idField`, not both/)
    })

    test('what `read` throws rejects the call', async () => {
        const failing: RecordConversion<Envelope> = {
            ...envelope,
            read: () => {
                throw new Error('not a record')
            },
        }
        const service = new FakeService()
        const source = new FeathersRecordSource<Envelope>(service, { convert: failing })
        service.result = { _id: 5 }

        expect(source.get('5')).rejects.toThrow('not a record')
    })
})

describe('a change event whose record cannot be converted', () => {
    test('is not delivered, and is reported to `onEventError`', () => {
        const errors: unknown[] = []
        const { service, source } = setup({ idField: '_id', onEventError: error => errors.push(error) })
        const heard: Item[] = []
        source.onCreated(record => heard.push(record))

        service.emit('created', { _id: 'a', id: 'its own', name: 'A' })
        service.emit('created', { _id: 'b', name: 'B' })

        expect(heard).toEqual([{ id: 'b', name: 'B' }])
        expect(errors).toHaveLength(1)
        expect((errors[0] as Error).message).toMatch(/field `id` of its own/)
    })

    test("so is one that the app's own `read` throws on", () => {
        const errors: unknown[] = []
        const service = new FakeService()
        const source = new FeathersRecordSource<Item>(service, {
            convert: {
                read: () => {
                    throw new Error('not a record')
                },
                write: data => data,
            },
            onEventError: error => errors.push(error),
        })
        const heard: Item[] = []
        source.onPatched(record => heard.push(record))

        expect(() => service.emit('patched', { id: 'a' })).not.toThrow()
        expect(heard).toEqual([])
        expect(errors).toEqual([new Error('not a record')])
    })

    test('is logged with the path of the service, without the option', () => {
        const logged: unknown[][] = []
        const original = console.error
        console.error = (...args: unknown[]) => logged.push(args)

        try {
            const { service, source } = setup({ idField: '_id', path: 'messages' })
            source.onCreated(() => {})
            service.emit('created', { _id: 'a', id: 'its own' })
        } finally {
            console.error = original
        }

        expect(logged).toHaveLength(1)
        expect(logged[0]![0]).toMatch(/^FeathersRecordSource 'messages': a change event was not delivered/)
        expect(logged[0]![1]).toBeInstanceOf(Error)
    })

    test("what a listener itself throws is not caught: it is the listener's own", () => {
        const errors: unknown[] = []
        const { service, source } = setup({ onEventError: error => errors.push(error) })
        source.onCreated(() => {
            throw new Error('from the listener')
        })

        expect(() => service.emit('created', { id: 'a', name: 'A' })).toThrow('from the listener')
        expect(errors).toEqual([])
    })
})
