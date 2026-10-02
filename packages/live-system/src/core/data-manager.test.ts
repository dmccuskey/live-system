import { describe, expect, test } from 'bun:test'
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

    rename(id: string, name: string): Promise<Item> {
        return this.source.patch(id, { name })
    }
}

// A source whose find() and get() wait until the test lets them through
class GatedSource extends MemoryRecordSource<Item> {
    findGate: Promise<void> | undefined
    getGate: Promise<void> | undefined
    getFailure: Error | undefined
    gets: string[] = []
    listeners = 0

    override async find(): Promise<Item[]> {
        // The snapshot is taken first: what changes while it travels is not in it
        const records = await super.find()
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
            ['added', second]
        ])
    })

    test('imports in one batch, so the store changes once', async () => {
        const { store, manager } = setup([first, second, third])
        let changes = 0
        const stop = watch(
            () => Object.keys(store.records),
            () => (changes += 1),
            { flush: 'sync' }
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

    test('a refetch that fails counts the record as removed', async () => {
        const { source, store, manager } = setup([first, second])
        const { promise, resolve } = Promise.withResolvers<void>()
        source.findGate = promise
        source.getFailure = new Error('not reachable')

        const init = manager.init()
        await settle()
        await source.patch('a', { name: 'patched' })
        resolve()
        await init

        expect(store.records).toEqual({ b: second })
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
