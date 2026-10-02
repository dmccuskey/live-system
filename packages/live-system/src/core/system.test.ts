import { describe, expect, test } from 'bun:test'
import { BaseManager, LiveSystem } from 'live-system/core'
import type { LiveSystemOptions, Unsubscribe } from 'live-system/core'

interface Context {
    name: string
}

type Hook = 'init' | 'start' | 'run' | 'stop'

// A manager that records its hooks in a shared list. A hook in `work` runs in place of doing nothing.
class Recorder extends BaseManager<Context> {
    constructor(
        context: Context,
        private readonly name: string,
        private readonly calls: string[],
        private readonly work: Partial<Record<Hook, () => void | Promise<void>>> = {}
    ) {
        super(context)
    }

    get seenContext(): Context {
        return this.context
    }

    override init() {
        return this.#hook('init')
    }
    override start() {
        return this.#hook('start')
    }
    override run() {
        return this.#hook('run')
    }
    override stop() {
        return this.#hook('stop')
    }

    async #hook(hook: Hook): Promise<void> {
        this.calls.push(`${this.name}.${hook}`)
        await this.work[hook]?.()
    }
}

const context: Context = { name: 'test' }

// A system that records its connect and disconnect, and its managers' hooks, in one list
function recordingSystem(options: Partial<LiveSystemOptions<Context>> = {}) {
    const calls: string[] = []
    const system = new LiveSystem<Context>({
        context,
        connect: () => void calls.push('connect'),
        disconnect: () => void calls.push('disconnect'),
        ...options
    })
    const add = (name: string, work?: Partial<Record<Hook, () => void | Promise<void>>>) =>
        system.addManager(shared => new Recorder(shared, name, calls, work))

    return { system, calls, add }
}

function failing(message: string): () => Promise<void> {
    return async () => {
        throw new Error(message)
    }
}

// A promise the test settles by hand, to hold a step open
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>(res => {
        resolve = res
    })
    return { promise, resolve }
}

// Lets the pending promise callbacks run
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('BaseManager', () => {
    class Plain extends BaseManager {}

    test('declares no routes', () => {
        expect(new Plain(undefined).routes()).toEqual({})
    })

    test('has hooks that do nothing', async () => {
        const manager = new Plain(undefined)

        await manager.init()
        await manager.start()
        await manager.run()
        await manager.stop()
    })

    test('a manager can declare routes', () => {
        class Servers extends BaseManager {
            override routes() {
                return { 'server/:id/restart': this.restart }
            }
            restart() {}
        }

        expect(Object.keys(new Servers(undefined).routes())).toEqual(['server/:id/restart'])
    })
})

describe('addManager()', () => {
    test('creates the manager with the shared context and returns it', () => {
        const { system, add } = recordingSystem()

        const users = add('users')
        const servers = add('servers')

        expect(users).toBeInstanceOf(Recorder)
        expect(users.seenContext).toBe(context)
        expect(servers.seenContext).toBe(context)
        expect(system.state).toBe('created')
    })

    test('calls no hook', () => {
        const { calls, add } = recordingSystem()

        add('users')

        expect(calls).toEqual([])
    })

    test('is refused once boot() has been called', async () => {
        const { system, add } = recordingSystem()
        const booting = system.boot()

        expect(() => add('late')).toThrow('before boot()')
        await booting
    })

    test('is refused after shutdown()', async () => {
        const { system, add } = recordingSystem()
        await system.shutdown()

        expect(() => add('late')).toThrow('before boot()')
    })
})

describe('boot()', () => {
    test('connects, then calls each hook on every manager in the order they were added', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b')

        await system.boot()

        expect(system.state).toBe('running')
        expect(calls).toEqual(['connect', 'a.init', 'b.init', 'a.start', 'b.start', 'a.run', 'b.run'])
    })

    test('waits for each manager before the next', async () => {
        const gate = deferred()
        const { system, calls, add } = recordingSystem()
        add('a', { init: () => gate.promise })
        add('b')

        const booting = system.boot()
        await settle()
        expect(calls).toEqual(['connect', 'a.init'])

        gate.resolve()
        await booting
        expect(calls.slice(2, 4)).toEqual(['b.init', 'a.start'])
    })

    test('works with no managers and no connections', async () => {
        const system = new LiveSystem({ context: undefined })

        await system.boot()

        expect(system.state).toBe('running')
    })

    test('cannot be called twice', async () => {
        const { system } = recordingSystem()
        await system.boot()

        expect(() => system.boot()).toThrow('only be called once')
    })

    test('cannot be called after shutdown()', async () => {
        const { system } = recordingSystem()
        await system.shutdown()

        expect(() => system.boot()).toThrow('not after shutdown()')
    })
})

describe('a failed boot()', () => {
    test('a manager failing in init: those begun are stopped in reverse, and the error is passed on', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b', { init: failing('b is broken') })
        add('c')

        await expect(system.boot()).rejects.toThrow('b is broken')

        expect(calls).toEqual(['connect', 'a.init', 'b.init', 'b.stop', 'a.stop', 'disconnect'])
        expect(system.state).toBe('stopped')
    })

    test('a manager failing in start: every manager is stopped', async () => {
        const { system, calls, add } = recordingSystem()
        add('a', { start: failing('a cannot start') })
        add('b')

        await expect(system.boot()).rejects.toThrow('a cannot start')

        expect(calls).toEqual(['connect', 'a.init', 'b.init', 'a.start', 'b.stop', 'a.stop', 'disconnect'])
    })

    test('a manager failing in run: every manager is stopped', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b', { run: failing('b cannot run') })

        await expect(system.boot()).rejects.toThrow('b cannot run')

        expect(calls.slice(-3)).toEqual(['b.stop', 'a.stop', 'disconnect'])
    })

    test('a failing connect: no manager is touched, and what was opened is closed', async () => {
        const calls: string[] = []
        const { system, add } = recordingSystem({
            connect: failing('no database'),
            disconnect: () => void calls.push('disconnect')
        })
        add('a')

        await expect(system.boot()).rejects.toThrow('no database')

        expect(calls).toEqual(['disconnect'])
        expect(system.state).toBe('stopped')
    })

    test('the startup error wins over an error in the cleanup', async () => {
        const { system, add } = recordingSystem({ disconnect: failing('cannot close') })
        add('a', { start: failing('a cannot start'), stop: failing('a cannot stop') })

        await expect(system.boot()).rejects.toThrow('a cannot start')
    })

    test('a shutdown() afterwards stops nothing a second time', async () => {
        const { system, calls, add } = recordingSystem()
        add('a', { start: failing('a cannot start') })
        await system.boot().catch(() => {})
        const after = calls.length

        await system.shutdown()

        expect(calls.length).toBe(after)
    })
})

describe('shutdown()', () => {
    test('stops the managers in the reverse of the order they were added, then disconnects', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b')
        add('c')
        await system.boot()
        calls.length = 0

        await system.shutdown()

        expect(calls).toEqual(['c.stop', 'b.stop', 'a.stop', 'disconnect'])
        expect(system.state).toBe('stopped')
    })

    test('waits for each manager\'s stop()', async () => {
        const gate = deferred()
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b', { stop: () => gate.promise })
        await system.boot()
        calls.length = 0

        const stopping = system.shutdown()
        await settle()
        expect(calls).toEqual(['b.stop'])

        gate.resolve()
        await stopping
        expect(calls).toEqual(['b.stop', 'a.stop', 'disconnect'])
    })

    test('does nothing the second time', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        await system.boot()
        await system.shutdown()
        const after = calls.length

        await system.shutdown()

        expect(calls.length).toBe(after)
    })

    test('two calls at once stop the managers once', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        await system.boot()
        calls.length = 0

        await Promise.all([system.shutdown(), system.shutdown()])

        expect(calls).toEqual(['a.stop', 'disconnect'])
    })

    test('before boot() stops no manager and closes nothing', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')

        await system.shutdown()

        expect(calls).toEqual([])
        expect(system.state).toBe('stopped')
    })

    test('during boot() waits for the boot to settle, then stops', async () => {
        const gate = deferred()
        const { system, calls, add } = recordingSystem()
        add('a', { init: () => gate.promise })
        add('b')

        const booting = system.boot()
        await settle()
        const stopping = system.shutdown()
        await settle()
        expect(calls).toEqual(['connect', 'a.init'])

        gate.resolve()
        await booting
        await stopping

        expect(calls).toEqual([
            'connect', 'a.init', 'b.init', 'a.start', 'b.start', 'a.run', 'b.run',
            'b.stop', 'a.stop', 'disconnect'
        ])
        expect(system.state).toBe('stopped')
    })

    test('during a boot() that fails resolves, with the cleanup done once', async () => {
        const gate = deferred()
        const { system, calls, add } = recordingSystem()
        add('a', {
            init: async () => {
                await gate.promise
                throw new Error('a is broken')
            }
        })

        const booting = system.boot()
        const stopping = system.shutdown()
        gate.resolve()

        await expect(booting).rejects.toThrow('a is broken')
        await stopping
        expect(calls).toEqual(['connect', 'a.init', 'a.stop', 'disconnect'])
    })

    test('a manager failing in stop does not keep the others from stopping', async () => {
        const { system, calls, add } = recordingSystem()
        add('a')
        add('b', { stop: failing('b cannot stop') })
        await system.boot()
        calls.length = 0

        await expect(system.shutdown()).rejects.toThrow('b cannot stop')

        expect(calls).toEqual(['b.stop', 'a.stop', 'disconnect'])
    })

    test('several managers failing in stop are reported together', async () => {
        const { system, add } = recordingSystem()
        add('a', { stop: failing('a cannot stop') })
        add('b', { stop: failing('b cannot stop') })
        await system.boot()

        const error = await system.shutdown().catch(caught => caught)

        expect(error).toBeInstanceOf(AggregateError)
        expect(error.errors.map((each: Error) => each.message)).toEqual(['b cannot stop', 'a cannot stop'])
    })
})

describe('two systems', () => {
    test('run side by side without sharing managers', async () => {
        const one = recordingSystem()
        const other = recordingSystem()
        one.add('a')
        other.add('b')

        await one.system.boot()
        await other.system.boot()
        await one.system.shutdown()

        expect(one.system.state).toBe('stopped')
        expect(other.system.state).toBe('running')
        expect(other.calls).toEqual(['connect', 'b.init', 'b.start', 'b.run'])
    })
})

describe('subscription cleanup', () => {
    // A source of ticks that hands out an Unsubscribe, as an event source does
    class Source {
        readonly listeners = new Set<() => void>()

        onTick(listener: () => void): Unsubscribe {
            this.listeners.add(listener)
            return () => this.listeners.delete(listener)
        }

        tick(): void {
            for (const listener of [...this.listeners]) listener()
        }
    }

    class Counter extends BaseManager<Context> {
        ticks = 0
        #subscriptions: Unsubscribe[] = []

        constructor(context: Context, private readonly source: Source) {
            super(context)
        }

        override async start() {
            this.#subscriptions.push(this.source.onTick(() => (this.ticks += 1)))
        }

        override async stop() {
            for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()
        }
    }

    test('a manager releases its subscriptions in stop()', async () => {
        const source = new Source()
        const system = new LiveSystem<Context>({ context })
        const counter = system.addManager(shared => new Counter(shared, source))

        await system.boot()
        source.tick()
        await system.shutdown()
        source.tick()

        expect(counter.ticks).toBe(1)
        expect(source.listeners.size).toBe(0)
    })

    test('a boot that fails later leaves no listener behind', async () => {
        const source = new Source()
        const system = new LiveSystem<Context>({ context })
        system.addManager(shared => new Counter(shared, source))
        system.addManager(shared => new Recorder(shared, 'broken', [], { start: failing('broken') }))

        await expect(system.boot()).rejects.toThrow('broken')

        expect(source.listeners.size).toBe(0)
    })
})
