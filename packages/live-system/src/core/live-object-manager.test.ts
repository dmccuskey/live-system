import { describe, expect, spyOn, test } from 'bun:test'
import { defineRecordStore, LiveObject, LiveObjectManager, LiveSystem, MemoryRecordSource } from 'live-system/core'
import type { LiveObjectOptions, RecordSource, RecordStore } from 'live-system/core'
import { createPinia } from 'pinia'

interface Item {
    id: string
    name: string
}

const first: Item = { id: 'a', name: 'first' }
const second: Item = { id: 'b', name: 'second' }

// What every object in a test writes its calls to, as 'a:init'
type Log = string[]

interface Behavior {
    /** The phase in which the object fails. */
    failIn?: 'init' | 'start' | 'run'
    /** Makes init() wait until it resolves. */
    initGate?: Promise<void>
    failInRelease?: boolean
}

// An object that reads its record from the store by ID, and records what is called on it
class Thing extends LiveObject {
    constructor(
        readonly id: string,
        private readonly store: RecordStore<Item>,
        private readonly source: RecordSource<Item>,
        private readonly log: Log,
        private readonly behavior: Behavior,
        options: LiveObjectOptions,
    ) {
        super(options)
        this.log.push(`${id}:created`)
    }

    get record(): Item | undefined {
        return this.store.get(this.id)
    }

    rename(name: string): Promise<Item> {
        return this.source.patch(this.id, { name })
    }

    override async init(): Promise<void> {
        await this.behavior.initGate
        this.#step('init')
    }

    override start(): void {
        this.#step('start')
    }

    override async run(): Promise<void> {
        this.#step('run')
    }

    protected override release(): void {
        this.log.push(`${this.id}:release`)

        if (this.behavior.failInRelease) throw new Error(`${this.id} failed in release`)
    }

    #step(name: 'init' | 'start' | 'run'): void {
        this.log.push(`${this.id}:${name}`)

        if (this.behavior.failIn === name) throw new Error(`${this.id} failed in ${name}`)
    }
}

class ThingManager<C = unknown> extends LiveObjectManager<Item, Thing, C> {
    log: Log = []
    behavior: Record<string, Behavior> = {}
    failures: [string, unknown][] = []
    failToCreate: string | undefined

    protected override createObject(record: Item, options: LiveObjectOptions): Thing {
        if (this.failToCreate === record.id) throw new Error(`${record.id} cannot be created`)

        return new Thing(record.id, this.records, this.source, this.log, this.behavior[record.id] ?? {}, options)
    }

    protected override objectFailed(object: Thing, error: unknown): void {
        this.failures.push([object.id, error])
    }
}

function setup(records: Item[] = []) {
    const source = new MemoryRecordSource<Item>(records)
    const store = defineRecordStore<Item>('items')(createPinia())
    const manager = new ThingManager(undefined, source, store)

    return { source, store, manager }
}

async function boot(manager: ThingManager): Promise<void> {
    await manager.init()
    await manager.start()
    await manager.run()
}

// Lets the promises already resolved run their continuations
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('startup: objects follow their manager through the phases', () => {
    test('init() creates an object for each record and inits it', async () => {
        const { manager } = setup([first, second])

        await manager.init()

        expect([...manager.objects.keys()]).toEqual(['a', 'b'])
        expect(manager.log).toEqual(['a:created', 'b:created', 'a:init', 'b:init'])
    })

    test('every object is created before any is initialized', async () => {
        const { manager } = setup([first, second])

        await manager.init()

        expect(manager.log.indexOf('b:created')).toBeLessThan(manager.log.indexOf('a:init'))
    })

    test('start() starts the objects, and run() runs them', async () => {
        const { manager } = setup([first, second])

        await manager.init()
        manager.log.length = 0
        await manager.start()

        expect(manager.log).toEqual(['a:start', 'b:start'])

        manager.log.length = 0
        await manager.run()

        expect(manager.log).toEqual(['a:run', 'b:run'])
    })

    test('init() waits for the objects', async () => {
        const { manager } = setup([first])
        const { promise, resolve } = Promise.withResolvers<void>()
        manager.behavior.a = { initGate: promise }
        let done = false

        const init = manager.init().then(() => (done = true))
        await settle()

        expect(done).toBe(false)

        resolve()
        await init

        expect(manager.log).toEqual(['a:created', 'a:init'])
    })

    test('an object finds its record in the store from the start', async () => {
        const { manager } = setup([first])

        await manager.init()

        expect(manager.getObject('a')?.record).toEqual(first)
    })

    test('works with no records', async () => {
        const { manager } = setup()

        await boot(manager)

        expect(manager.objects.size).toBe(0)
    })

    test('getObject() returns undefined for an unknown ID', async () => {
        const { manager } = setup([first])

        await manager.init()

        expect(manager.getObject('missing')).toBeUndefined()
    })
})

describe('a record created later', () => {
    test('while running: its object is taken through init, start and run at once', async () => {
        const { source, manager } = setup([first])
        await boot(manager)
        manager.log.length = 0

        await source.create(second)
        await settle()

        expect(manager.log).toEqual(['b:created', 'b:init', 'b:start', 'b:run'])
        expect(manager.getObject('b')).toBeDefined()
    })

    test('between init() and start(): it is initialized, and then follows the manager', async () => {
        const { source, manager } = setup([first])
        await manager.init()
        manager.log.length = 0

        await source.create(second)
        await settle()

        expect(manager.log).toEqual(['b:created', 'b:init'])

        await manager.start()
        await manager.run()

        expect(manager.log).toEqual(['b:created', 'b:init', 'a:start', 'b:start', 'a:run', 'b:run'])
    })

    test('a phase of the manager waits for an object still in an earlier one', async () => {
        const { source, manager } = setup()
        const { promise, resolve } = Promise.withResolvers<void>()
        manager.behavior.b = { initGate: promise }
        await manager.init()

        await source.create(second)
        let started = false
        const start = manager.start().then(() => (started = true))
        await settle()

        expect(started).toBe(false)
        expect(manager.log).toEqual(['b:created'])

        resolve()
        await start

        expect(manager.log).toEqual(['b:created', 'b:init', 'b:start'])
    })

    test('a created event for a record that has an object creates no second one', async () => {
        const { source, store, manager } = setup([first])
        await boot(manager)
        const object = manager.getObject('a')
        manager.log.length = 0

        // The store lost the record, so the next change looks like a new record
        store.remove('a')
        await source.patch('a', { name: 'patched' })
        await settle()

        expect(manager.getObject('a')).toBe(object)
        expect(manager.log).toEqual([])
    })
})

describe('a record changed or removed', () => {
    test('a change reaches the object through the store, with no call on it', async () => {
        const { source, manager } = setup([first])
        await boot(manager)
        const object = manager.getObject('a')
        manager.log.length = 0

        await source.patch('a', { name: 'patched' })

        expect(object?.record).toEqual({ id: 'a', name: 'patched' })
        expect(manager.getObject('a')).toBe(object)
        expect(manager.log).toEqual([])
    })

    test('an object writes its record through the source, and sees it when the event is back', async () => {
        const { manager } = setup([first])
        await boot(manager)
        const object = manager.getObject('a')

        await object?.rename('renamed')

        expect(object?.record).toEqual({ id: 'a', name: 'renamed' })
    })

    test('a removed record destroys its object', async () => {
        const { source, manager } = setup([first, second])
        await boot(manager)
        const object = manager.getObject('a')
        manager.log.length = 0

        await source.remove('a')

        expect(object?.isDestroyed).toBe(true)
        expect(manager.log).toEqual(['a:release'])
        expect([...manager.objects.keys()]).toEqual(['b'])
    })

    test('a record removed while its object is starting ends the startup there', async () => {
        const { source, manager } = setup()
        const { promise, resolve } = Promise.withResolvers<void>()
        manager.behavior.b = { initGate: promise }
        await boot(manager)

        await source.create(second)
        await source.remove('b')
        resolve()
        await settle()

        expect(manager.log).toEqual(['b:created', 'b:release', 'b:init'])
        expect(manager.objects.size).toBe(0)
        expect(manager.failures).toEqual([])
    })

    test('a record created again after its removal gets a new object', async () => {
        const { source, manager } = setup([first])
        await boot(manager)
        const object = manager.getObject('a')

        await source.remove('a')
        await source.create(first)
        await settle()

        expect(manager.getObject('a')).toBeDefined()
        expect(manager.getObject('a')).not.toBe(object)
        expect(manager.getObject('a')?.isDestroyed).toBe(false)
    })
})

describe('an object that ends itself', () => {
    test('leaves the manager, and its record stays', async () => {
        const { store, manager } = setup([first, second])
        await boot(manager)

        manager.getObject('a')?.destroy()

        expect([...manager.objects.keys()]).toEqual(['b'])
        expect(store.get('a')).toEqual(first)
    })

    test('an old object destroyed late does not remove its successor', async () => {
        const { source, manager } = setup([first])
        manager.behavior.a = { failInRelease: true }
        await boot(manager)
        const old = manager.getObject('a')

        // Its release fails, but it is gone all the same
        await source.remove('a').catch(() => {})
        manager.behavior.a = {}
        await source.create(first)
        await settle()
        const successor = manager.getObject('a')
        old?.destroy()

        expect(successor).not.toBe(old)
        expect(manager.getObject('a')).toBe(successor)
    })
})

describe('an object that fails to start', () => {
    test('during startup: it is destroyed and reported, and the others carry on', async () => {
        const { manager } = setup([first, second])
        manager.behavior.a = { failIn: 'init' }

        await boot(manager)

        expect([...manager.objects.keys()]).toEqual(['b'])
        expect(manager.failures).toEqual([['a', new Error('a failed in init')]])
        expect(manager.log).toEqual(['a:created', 'b:created', 'a:init', 'b:init', 'a:release', 'b:start', 'b:run'])
    })

    test('in a later phase: it gets no further phase', async () => {
        const { manager } = setup([first])
        manager.behavior.a = { failIn: 'start' }

        await boot(manager)

        expect(manager.log).toEqual(['a:created', 'a:init', 'a:start', 'a:release'])
        expect(manager.objects.size).toBe(0)
    })

    test('while running: it is destroyed and reported, and its record stays', async () => {
        const { source, store, manager } = setup([first])
        manager.behavior.b = { failIn: 'run' }
        await boot(manager)
        manager.log.length = 0

        await source.create(second)
        await settle()

        expect(manager.log).toEqual(['b:created', 'b:init', 'b:start', 'b:run', 'b:release'])
        expect([...manager.objects.keys()]).toEqual(['a'])
        expect(manager.failures).toEqual([['b', new Error('b failed in run')]])
        expect(store.get('b')).toEqual(second)
    })

    test('it is reported even when its release fails too', async () => {
        const { manager } = setup([first])
        manager.behavior.a = { failIn: 'init', failInRelease: true }

        expect(manager.init()).rejects.toThrow('a failed in release')
        await settle()

        expect(manager.failures).toEqual([['a', new Error('a failed in init')]])
        expect(manager.objects.size).toBe(0)
    })

    test('the default report is a console.error', async () => {
        class PlainManager extends LiveObjectManager<Item, Thing> {
            protected override createObject(record: Item, options: LiveObjectOptions): Thing {
                return new Thing(record.id, this.records, this.source, [], { failIn: 'init' }, options)
            }
        }
        const source = new MemoryRecordSource<Item>([first])
        const manager = new PlainManager(undefined, source, defineRecordStore<Item>('items')(createPinia()))
        const error = spyOn(console, 'error').mockImplementation(() => {})

        await manager.init()

        expect(error).toHaveBeenCalledWith('PlainManager: a live object failed to start', new Error('a failed in init'))
        error.mockRestore()
    })

    test('an object that cannot be created during startup fails init()', async () => {
        const { manager } = setup([first])
        manager.failToCreate = 'a'

        expect(manager.init()).rejects.toThrow('a cannot be created')
    })
})

describe('stop()', () => {
    test('destroys every object, the last created first', async () => {
        const { manager } = setup([first, second])
        await boot(manager)
        const objects = [...manager.objects.values()]
        manager.log.length = 0

        await manager.stop()

        expect(manager.log).toEqual(['b:release', 'a:release'])
        expect(objects.every(object => object.isDestroyed)).toBe(true)
        expect(manager.objects.size).toBe(0)
    })

    test('creates no object for a record created afterwards', async () => {
        const { source, manager } = setup([first])
        await boot(manager)
        await manager.stop()
        manager.log.length = 0

        await source.create(second)
        await settle()

        expect(manager.log).toEqual([])
    })

    test('an object that fails to release does not keep the others from being destroyed', async () => {
        const { manager } = setup([first, second])
        manager.behavior.b = { failInRelease: true }
        await boot(manager)
        manager.log.length = 0

        expect(manager.stop()).rejects.toThrow('b failed in release')
        await settle()

        expect(manager.log).toEqual(['b:release', 'a:release'])
        expect(manager.objects.size).toBe(0)
    })

    test('several failures are passed on together', async () => {
        const { manager } = setup([first, second])
        manager.behavior.a = { failInRelease: true }
        manager.behavior.b = { failInRelease: true }
        await boot(manager)

        const failure = await manager.stop().catch(error => error)

        expect(failure).toBeInstanceOf(AggregateError)
        expect(failure.errors).toHaveLength(2)
    })

    test('an object still starting gets no further phase', async () => {
        const { source, manager } = setup()
        const { promise, resolve } = Promise.withResolvers<void>()
        manager.behavior.b = { initGate: promise }
        await boot(manager)
        await source.create(second)

        await manager.stop()
        resolve()
        await settle()

        expect(manager.log).toEqual(['b:created', 'b:release', 'b:init'])
    })

    test('can be called without init()', async () => {
        const { manager } = setup([first])

        await manager.stop()

        expect(manager.objects.size).toBe(0)
    })
})

describe('in a LiveSystem', () => {
    test('boot() takes the objects through every phase, and shutdown() destroys them', async () => {
        const source = new MemoryRecordSource<Item>([first, second])
        const store = defineRecordStore<Item>('items')(createPinia())
        const system = new LiveSystem({ context: { store } })
        const manager = system.addManager(context => new ThingManager(context, source, context.store))

        await system.boot()

        expect(manager.log).toEqual([
            'a:created',
            'b:created',
            'a:init',
            'b:init',
            'a:start',
            'b:start',
            'a:run',
            'b:run',
        ])

        manager.log.length = 0
        await system.shutdown()

        expect(manager.log).toEqual(['b:release', 'a:release'])
    })

    test('the objects of every manager are initialized before any is started', async () => {
        const store = defineRecordStore<Item>('items')(createPinia())
        const others = defineRecordStore<Item>('others')(createPinia())
        const system = new LiveSystem({ context: {} })
        const log: Log = []
        const one = system.addManager(context => new ThingManager(context, new MemoryRecordSource([first]), store))
        const two = system.addManager(context => new ThingManager(context, new MemoryRecordSource([second]), others))
        one.log = log
        two.log = log

        await system.boot()

        expect(log).toEqual(['a:created', 'a:init', 'b:created', 'b:init', 'a:start', 'b:start', 'a:run', 'b:run'])

        await system.shutdown()
    })
})
