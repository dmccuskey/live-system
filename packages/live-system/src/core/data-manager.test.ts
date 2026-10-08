import { describe, expect, spyOn, test } from 'bun:test'
import { DataManager, defineRecordStore, LiveSystem, MemoryRecordSource } from 'live-system/core'
import type { RecordStore } from 'live-system/core'
import { createPinia } from 'pinia'
import { watch } from 'vue'

interface Item {
    id: string
    name: string
}

const first: Item = { id: 'a', name: 'first' }
const second: Item = { id: 'b', name: 'second' }
const third: Item = { id: 'c', name: 'third' }

// A manager that records what its hooks are told
class ItemManager<C = unknown> extends DataManager<Item, C> {
    calls: [string, ...Item[]][] = []

    protected override recordAdded(record: Item): void {
        this.calls.push(['added', record])
    }

    protected override recordChanged(record: Item, previous: Item): void {
        this.calls.push(['changed', record, previous])
    }

    protected override recordRemoved(record: Item): void {
        this.calls.push(['removed', record])
    }

    failures: unknown[] = []

    protected override resyncFailed(error: unknown): void {
        this.failures.push(error)
    }

    rename(id: string, name: string): Promise<Item> {
        return this.source.patch(id, { name })
    }
}

// A source whose find() and get() wait until the test lets them through
class GatedSource extends MemoryRecordSource<Item> {
    findGate: Promise<void> | undefined
    getGate: Promise<void> | undefined
    getFailure: Error | undefined
    finds = 0
    gets: string[] = []
    listeners = 0

    override async find(): Promise<Item[]> {
        // The snapshot is taken first: what changes while it travels is not in it
        const records = await super.find()
        this.finds += 1
        await this.findGate

        return records
    }

    override async get(id: string): Promise<Item> {
        this.gets.push(id)
        await this.getGate

        if (this.getFailure) throw this.getFailure

        return super.get(id)
    }

    override onCreated(listener: (record: Item) => void) {
        return this.#count(super.onCreated(listener))
    }

    override onUpdated(listener: (record: Item) => void) {
        return this.#count(super.onUpdated(listener))
    }

    override onPatched(listener: (record: Item) => void) {
        return this.#count(super.onPatched(listener))
    }

    override onRemoved(listener: (record: Item) => void) {
        return this.#count(super.onRemoved(listener))
    }

    #count(unsubscribe: () => void) {
        this.listeners += 1

        return () => {
            this.listeners -= 1
            unsubscribe()
        }
    }
}

function setup(records: Item[] = []) {
    const source = new GatedSource(records)
    const store: RecordStore<Item> = defineRecordStore<Item>('items')(createPinia())
    const manager = new ItemManager(undefined, source, store)

    return { source, store, manager }
}

// Lets the promises already resolved run their continuations
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('init(): the startup sync', () => {
    test('loads every record into the store', async () => {
        const { store, manager } = setup([first, second])

        await manager.init()

        expect(store.records).toEqual({ a: first, b: second })
    })

    test('works with no records', async () => {
        const { store, manager } = setup()

        await manager.init()

        expect(store.records).toEqual({})
        expect(manager.calls).toEqual([])
    })

    test('calls recordAdded for each record, once they are all in the store', async () => {
        const { store, manager } = setup([first, second])
        const sizes: number[] = []
        manager['recordAdded'] = () => sizes.push(Object.keys(store.records).length)

        await manager.init()

        expect(sizes).toEqual([2, 2])
    })

    test('reports the loaded records as added, in order', async () => {
        const { manager } = setup([first, second])

        await manager.init()

        expect(manager.calls).toEqual([
            ['added', first],
            ['added', second],
        ])
    })

    test('imports in one batch, so the store changes once', async () => {
        const { store, manager } = setup([first, second, third])
        let changes = 0
        const stop = watch(
            () => Object.keys(store.records),
            () => (changes += 1),
            { flush: 'sync' },
        )

        await manager.init()
        stop()

        expect(changes).toBe(1)
    })

    test('subscribes before it fetches', async () => {
        const { source, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()

        expect(source.listeners).toBe(4)

        resolve()
        await init
    })

    test('does not apply a change that arrives during the load', async () => {
        const { source, store, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await source.create(second)

        expect(store.records).toEqual({})
        expect(manager.calls).toEqual([])

        resolve()
        await init
    })

    test('a record created during the load is in the store afterwards', async () => {
        const { source, store, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await settle()
        await source.create(second)
        resolve()
        await init

        expect(store.records).toEqual({ a: first, b: second })
        expect(source.gets).toEqual(['b'])
    })

    test('a record changed during the load is fetched again, not taken from the snapshot', async () => {
        const { source, store, manager } = setup([first, second])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await settle()
        await source.patch('a', { name: 'patched' })
        await source.update('b', { id: 'b', name: 'updated' })
        resolve()
        await init

        expect(store.records).toEqual({ a: { id: 'a', name: 'patched' }, b: { id: 'b', name: 'updated' } })
        expect(source.gets.sort()).toEqual(['a', 'b'])
    })

    test('a record removed during the load is not in the store', async () => {
        const { source, store, manager } = setup([first, second])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await settle()
        await source.remove('a')
        resolve()
        await init

        expect(store.records).toEqual({ b: second })
        expect(manager.calls).toEqual([['added', second]])
    })

    test('a record created and removed during the load never appears', async () => {
        const { source, store, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await settle()
        await source.create(second)
        await source.remove('b')
        resolve()
        await init

        expect(store.records).toEqual({ a: first })
    })

    test('a record that changed several times is fetched once', async () => {
        const { source, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await settle()
        await source.patch('a', { name: 'one' })
        await source.patch('a', { name: 'two' })
        resolve()
        await init

        expect(source.gets).toEqual(['a'])
    })

    test('fetches nothing again when nothing changed', async () => {
        const { source, manager } = setup([first, second])

        await manager.init()

        expect(source.gets).toEqual([])
    })

    test('a change during the refetch is reconciled too', async () => {
        const { source, store, manager } = setup([first])
        const find = Promise.withResolvers<void>()
        const get = Promise.withResolvers<void>()
        source.findGate = find.promise
        source.getGate = get.promise

        const init = manager.init()
        await settle()
        await source.patch('a', { name: 'one' })
        find.resolve()
        await settle()

        // The manager is now waiting for get('a')
        expect(source.gets).toEqual(['a'])
        await source.create(second)
        await source.patch('a', { name: 'two' })
        get.resolve()
        await init

        expect(store.records).toEqual({ a: { id: 'a', name: 'two' }, b: second })
        expect(source.gets).toEqual(['a', 'b', 'a'])
    })

    test('a refetch that fails for another reason than a missing record fails the load', async () => {
        const { source, store, manager } = setup([first, second])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise
        source.getFailure = new Error('not reachable')

        const init = manager.init()
        await settle()
        await source.patch('a', { name: 'patched' })
        resolve()

        expect(init).rejects.toThrow('not reachable')
        expect(store.records).toEqual({})
    })

    test('rejects when the snapshot cannot be fetched, and stop() then ends the subscriptions', async () => {
        const { source, store, manager } = setup([first])
        source.findGate = Promise.reject(new Error('no connection'))

        expect(manager.init()).rejects.toThrow('no connection')
        await settle()
        expect(source.listeners).toBe(4)

        await manager.stop()

        expect(source.listeners).toBe(0)
        expect(store.records).toEqual({})
    })

    test('a manager stopped during the load imports nothing', async () => {
        const { source, store, manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        const init = manager.init()
        await manager.stop()
        resolve()
        await init

        expect(store.records).toEqual({})
        expect(manager.calls).toEqual([])
    })
})

describe('live: after init()', () => {
    test('a created record is added to the store', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        manager.calls = []

        await source.create(second)

        expect(store.records).toEqual({ a: first, b: second })
        expect(manager.calls).toEqual([['added', second]])
    })

    test('a patched record replaces the one in the store', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        manager.calls = []

        await source.patch('a', { name: 'patched' })

        expect(store.records).toEqual({ a: { id: 'a', name: 'patched' } })
        expect(manager.calls).toEqual([['changed', { id: 'a', name: 'patched' }, first]])
    })

    test('an updated record replaces the one in the store', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        manager.calls = []

        await source.update('a', { id: 'a', name: 'updated' })

        expect(store.records).toEqual({ a: { id: 'a', name: 'updated' } })
        expect(manager.calls).toEqual([['changed', { id: 'a', name: 'updated' }, first]])
    })

    test('a removed record leaves the store', async () => {
        const { source, store, manager } = setup([first, second])
        await manager.init()
        manager.calls = []

        await source.remove('a')

        expect(store.records).toEqual({ b: second })
        expect(manager.calls).toEqual([['removed', first]])
    })

    test('the hook is called after the store has changed', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        const seen: unknown[] = []
        manager['recordAdded'] = record => seen.push(store.get(record.id))
        manager['recordChanged'] = record => seen.push(store.get(record.id))
        manager['recordRemoved'] = record => seen.push(store.get(record.id))

        await source.create(second)
        await source.patch('b', { name: 'patched' })
        await source.remove('b')

        expect(seen).toEqual([second, { id: 'b', name: 'patched' }, undefined])
    })

    test('a change for a record the store does not have adds it', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        store.remove('a')
        manager.calls = []

        await source.patch('a', { name: 'patched' })

        expect(store.records).toEqual({ a: { id: 'a', name: 'patched' } })
        expect(manager.calls).toEqual([['added', { id: 'a', name: 'patched' }]])
    })

    test('a removal for a record the store does not have does nothing', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        store.remove('a')
        manager.calls = []

        await source.remove('a')

        expect(manager.calls).toEqual([])
    })

    test('a write through the source changes the store only by its event', async () => {
        const { store, manager } = setup([first])
        await manager.init()

        const renamed = await manager.rename('a', 'renamed')

        expect(renamed).toEqual({ id: 'a', name: 'renamed' })
        expect(store.get('a')).toEqual(renamed)
    })

    test('a write that fails leaves the store as it was', async () => {
        const { store, manager } = setup([first])
        await manager.init()

        expect(manager.rename('missing', 'renamed')).rejects.toThrow()
        await settle()

        expect(store.records).toEqual({ a: first })
    })
})

describe('resync: after the source was lost and is back', () => {
    // A live manager whose source changed while it could not be heard
    async function lost(records: Item[], change: (source: GatedSource) => Promise<unknown>) {
        const context = setup(records)
        await context.manager.init()
        context.manager.calls = []

        context.source.disconnect()
        await change(context.source)

        return context
    }

    test('a record created meanwhile is added', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))

        expect(store.records).toEqual({ a: first })

        source.reconnect()
        await settle()

        expect(store.records).toEqual({ a: first, b: second })
        expect(manager.calls).toEqual([['added', second]])
    })

    test('a record changed meanwhile is replaced', async () => {
        const { source, store, manager } = await lost([first, second], source => source.patch('a', { name: 'changed' }))

        source.reconnect()
        await settle()

        expect(store.records).toEqual({ a: { id: 'a', name: 'changed' }, b: second })
        expect(manager.calls).toEqual([['changed', { id: 'a', name: 'changed' }, first]])
    })

    test('a record removed meanwhile leaves the store', async () => {
        const { source, store, manager } = await lost([first, second], source => source.remove('a'))

        source.reconnect()
        await settle()

        expect(store.records).toEqual({ b: second })
        expect(manager.calls).toEqual([['removed', first]])
    })

    test('every record removed meanwhile empties the store', async () => {
        const { source, store, manager } = await lost([first, second], async source => {
            await source.remove('a')
            await source.remove('b')
        })

        source.reconnect()
        await settle()

        expect(store.records).toEqual({})
        expect(manager.calls).toEqual([
            ['removed', first],
            ['removed', second],
        ])
    })

    test('a record that is equal keeps its object, and no hook is called', async () => {
        const { source, store, manager } = await lost([first, second], source => source.patch('b', { name: 'changed' }))
        const before = store.get('a')

        source.reconnect()
        await settle()

        expect(store.get('a')).toBe(before as Item)
        expect(manager.calls).toHaveLength(1)
    })

    test('nothing changed meanwhile: nothing watching the store reacts', async () => {
        const { source, store, manager } = await lost([first, second], async () => {})
        let reactions = 0
        watch(
            () => ({ ...store.records }),
            () => (reactions += 1),
            { flush: 'sync' },
        )

        source.reconnect()
        await settle()

        expect(source.finds).toBe(2)
        expect(reactions).toBe(0)
        expect(manager.calls).toEqual([])
    })

    test('the hooks are called once the store holds every difference', async () => {
        const { source, store, manager } = await lost([first, second], async source => {
            await source.remove('a')
            await source.patch('b', { name: 'changed' })
            await source.create(third)
        })
        const seen: string[][] = []
        const record = () => seen.push(Object.keys(store.records).sort())
        Object.assign(manager, { recordAdded: record, recordChanged: record, recordRemoved: record })

        source.reconnect()
        await settle()

        expect(seen).toEqual([
            ['b', 'c'],
            ['b', 'c'],
            ['b', 'c'],
        ])
    })

    test('the differences are reported as removed, changed, then added', async () => {
        const { source, manager } = await lost([first, second], async source => {
            await source.create(third)
            await source.patch('b', { name: 'changed' })
            await source.remove('a')
        })

        source.reconnect()
        await settle()

        expect(manager.calls.map(([name]) => name)).toEqual(['removed', 'changed', 'added'])
    })

    test('a change that arrives during the resync is not applied until it ends, and is not lost', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        source.reconnect()
        await settle()
        await source.patch('a', { name: 'during' })
        await source.create(third)

        expect(store.records).toEqual({ a: first })

        resolve()
        await settle()

        expect(store.records).toEqual({ a: { id: 'a', name: 'during' }, b: second, c: third })
        expect(source.gets.sort()).toEqual(['a', 'c'])
        expect(manager.calls.map(([name, record]) => [name, record?.id])).toEqual([
            ['changed', 'a'],
            ['added', 'b'],
            ['added', 'c'],
        ])
    })

    test('changes are applied as they arrive again after the resync', async () => {
        const { source, store } = await lost([first], async () => {})

        source.reconnect()
        await settle()
        await source.create(second)

        expect(store.records).toEqual({ a: first, b: second })
    })

    test('a second reconnect overtakes a resync that never returns', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        source.findGate = new Promise(() => {})

        source.reconnect()
        await settle()

        source.findGate = undefined
        await source.create(third)
        source.reconnect()
        await settle()

        expect(store.records).toEqual({ a: first, b: second, c: third })
        expect(manager.calls).toEqual([
            ['added', second],
            ['added', third],
        ])
    })

    test('a resync that is overtaken applies nothing when it returns', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        source.reconnect()
        await settle()
        source.findGate = undefined
        await source.remove('b')
        source.reconnect()
        await settle()
        resolve()
        await settle()

        expect(store.records).toEqual({ a: first })
        expect(manager.calls).toEqual([])
    })

    test('a resync that fails keeps the store, reports it, and changes are applied again', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        source.findGate = Promise.reject(new Error('no connection'))

        source.reconnect()
        await settle()

        expect(store.records).toEqual({ a: first })
        expect(manager.failures).toEqual([new Error('no connection')])

        await source.create(third)

        expect(store.records).toEqual({ a: first, c: third })
    })

    test('a refetch that fails for another reason than a missing record fails the resync: no record is removed', async () => {
        const { source, store, manager } = await lost([first, second], source => source.create(third))
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise
        source.getFailure = new Error('no connection')

        source.reconnect()
        await settle()
        await source.patch('a', { name: 'changed' })
        resolve()
        await settle()

        expect(store.records).toEqual({ a: first, b: second })
        expect(manager.calls).toEqual([])
        expect(manager.failures).toEqual([new Error('no connection')])
    })

    test('the reconnect after a failed resync syncs again', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        source.findGate = Promise.reject(new Error('no connection'))
        source.reconnect()
        await settle()

        source.findGate = undefined
        source.reconnect()
        await settle()

        expect(store.records).toEqual({ a: first, b: second })
        expect(manager.failures).toHaveLength(1)
    })

    test('the default report of a failed resync is a console.error', async () => {
        class PlainManager extends DataManager<Item> {}
        const source = new GatedSource([first])
        const manager = new PlainManager(undefined, source, defineRecordStore<Item>('items')(createPinia()))
        const error = spyOn(console, 'error').mockImplementation(() => {})

        try {
            await manager.init()
            source.findGate = Promise.reject(new Error('no connection'))
            source.reconnect()
            await settle()

            expect(error).toHaveBeenCalledWith(
                'PlainManager: the sync after a reconnect failed',
                new Error('no connection'),
            )
        } finally {
            error.mockRestore()
        }
    })

    test('a manager stopped during the resync applies nothing', async () => {
        const { source, store, manager } = await lost([first], source => source.create(second))
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise

        source.reconnect()
        await settle()
        await manager.stop()
        resolve()
        await settle()

        expect(store.records).toEqual({ a: first })
        expect(manager.calls).toEqual([])
    })

    test('a stopped manager does not resync', async () => {
        const { source, manager } = await lost([first], source => source.create(second))
        await manager.stop()

        source.reconnect()
        await settle()

        expect(source.finds).toBe(1)
    })

    test('a reconnect during the load starts it again, and init() ends with the newer one', async () => {
        const { source, store, manager } = setup([first])
        source.findGate = new Promise(() => {})

        const init = manager.init()
        await settle()
        source.findGate = undefined
        await source.create(second)
        source.reconnect()
        await init

        expect(store.records).toEqual({ a: first, b: second })
        expect(manager.calls).toEqual([
            ['added', first],
            ['added', second],
        ])
    })

    test('a reconnect after a failed load does nothing', async () => {
        const { source, store, manager } = setup([first])
        source.findGate = Promise.reject(new Error('no connection'))
        await manager.init().catch(() => {})

        source.findGate = undefined
        source.reconnect()
        await settle()

        expect(source.finds).toBe(1)
        expect(store.records).toEqual({})
    })

    test('stop() ends an init() whose fetch never returns', async () => {
        const { source, store, manager } = setup([first])
        source.findGate = new Promise(() => {})

        const init = manager.init()
        await settle()
        await manager.stop()
        await init

        expect(store.records).toEqual({})
    })
})

describe('stop()', () => {
    test('ends the subscriptions', async () => {
        const { source, manager } = setup([first])
        await manager.init()

        await manager.stop()

        expect(source.listeners).toBe(0)
    })

    test('changes after it do not reach the store', async () => {
        const { source, store, manager } = setup([first])
        await manager.init()
        await manager.stop()
        manager.calls = []

        await source.create(second)
        await source.remove('a')

        expect(store.records).toEqual({ a: first })
        expect(manager.calls).toEqual([])
    })

    test('can be called twice, and without init()', async () => {
        const { source, manager } = setup([first])

        await manager.stop()
        await manager.stop()

        expect(source.listeners).toBe(0)
    })
})

describe('in a LiveSystem', () => {
    test('boot() loads the store, and shutdown() ends the subscriptions', async () => {
        const source = new GatedSource([first, second])
        const store = defineRecordStore<Item>('items')(createPinia())
        const system = new LiveSystem({ context: { store } })
        system.addManager(context => new ItemManager(context, source, context.store))

        await system.boot()

        expect(store.records).toEqual({ a: first, b: second })

        await system.shutdown()

        expect(source.listeners).toBe(0)
    })

    test('a failed load fails the boot and leaves no subscription', async () => {
        const source = new GatedSource([first])
        source.findGate = Promise.reject(new Error('no connection'))
        const store = defineRecordStore<Item>('items')(createPinia())
        const system = new LiveSystem({ context: {} })
        system.addManager(context => new ItemManager(context, source, store))

        expect(system.boot()).rejects.toThrow('no connection')
        await system.shutdown()

        expect(source.listeners).toBe(0)
        expect(system.state).toBe('stopped')
    })
})
