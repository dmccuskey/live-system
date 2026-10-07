import { describe, expect, test } from 'bun:test'
import { FeathersRecordSource, type FeathersServiceLike } from './record-source.ts'

interface Item {
    id: string
    name: string
}

type Listener = (record: any) => void

/** A service that records its calls and answers with what the test gives it. */
class FakeService implements FeathersServiceLike {
    calls: unknown[][] = []
    result: unknown = undefined
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

        if (this.result instanceof Error) throw this.result

        return this.result
    }
}

const setup = (options?: ConstructorParameters<typeof FeathersRecordSource>[1]) => {
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
})
