import { describe, expect, test } from 'bun:test'
import { LifecycleRunner } from 'live-system/core'
import type { LifecycleOwner, LifecycleState } from 'live-system/core'
import { TransitionError } from 'micro-fsm'

type Step = keyof LifecycleOwner

// A system that records the calls made to it. A step in `work` runs in place of doing nothing.
function fakeSystem(work: Partial<LifecycleOwner> = {}): { system: LifecycleOwner; calls: Step[] } {
    const calls: Step[] = []
    const step = (name: Step) => async () => {
        calls.push(name)
        await work[name]?.()
    }

    return {
        calls,
        system: {
            connect: step('connect'),
            initManagers: step('initManagers'),
            startManagers: step('startManagers'),
            runManagers: step('runManagers'),
            stopManagers: step('stopManagers'),
        },
    }
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

describe('run()', () => {
    test('a new runner is in created, and has called nothing', () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        expect(lifecycle.state).toBe('created')
        expect(calls).toEqual([])
    })

    test('makes the transitions in order and ends in running', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()

        expect(calls).toEqual(['connect', 'initManagers', 'startManagers', 'runManagers'])
        expect(lifecycle.state).toBe('running')
    })

    test('each state is entered only when its work is done', async () => {
        const seen: LifecycleState[] = []
        const lifecycle: LifecycleRunner = new LifecycleRunner({
            connect: () => void seen.push(lifecycle.state),
            initManagers: () => void seen.push(lifecycle.state),
            startManagers: () => void seen.push(lifecycle.state),
            runManagers: () => void seen.push(lifecycle.state),
            stopManagers: () => void seen.push(lifecycle.state),
        })

        await lifecycle.run()
        await lifecycle.stop()

        expect(seen).toEqual(['created', 'ready', 'initialized', 'started', 'running'])
    })

    test('waits for a step before the next', async () => {
        const init = deferred()
        const { system, calls } = fakeSystem({ initManagers: () => init.promise })
        const lifecycle = new LifecycleRunner(system)

        const running = lifecycle.run()
        await settle()

        expect(calls).toEqual(['connect', 'initManagers'])
        expect(lifecycle.state).toBe('ready')

        init.resolve()
        await running

        expect(calls).toEqual(['connect', 'initManagers', 'startManagers', 'runManagers'])
        expect(lifecycle.state).toBe('running')
    })

    test('accepts steps that are not async', async () => {
        const lifecycle = new LifecycleRunner({
            connect() {},
            initManagers() {},
            startManagers() {},
            runManagers() {},
            stopManagers() {},
        })

        await lifecycle.run()

        expect(lifecycle.state).toBe('running')
    })

    test('can not run twice', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()

        await expect(lifecycle.run()).rejects.toBeInstanceOf(TransitionError)
        expect(calls).toHaveLength(4)
        expect(lifecycle.state).toBe('running')
    })
})

describe('a failing step', () => {
    const cases: { step: Step; state: LifecycleState; calls: Step[] }[] = [
        { step: 'connect', state: 'created', calls: ['connect'] },
        { step: 'initManagers', state: 'ready', calls: ['connect', 'initManagers'] },
        { step: 'startManagers', state: 'initialized', calls: ['connect', 'initManagers', 'startManagers'] },
        {
            step: 'runManagers',
            state: 'started',
            calls: ['connect', 'initManagers', 'startManagers', 'runManagers'],
        },
    ]

    for (const { step, state, calls: expected } of cases) {
        test(`${step}() stops the advance and leaves the state at ${state}`, async () => {
            const { system, calls } = fakeSystem({ [step]: failing('no') })
            const lifecycle = new LifecycleRunner(system)

            await expect(lifecycle.run()).rejects.toThrow('no')
            await settle()

            expect(calls).toEqual(expected)
            expect(lifecycle.state).toBe(state)
        })
    }

    test('passes on the error itself', async () => {
        const error = new Error('no connection')
        const { system } = fakeSystem({
            connect: async () => {
                throw error
            },
        })
        const lifecycle = new LifecycleRunner(system)

        await expect(lifecycle.run()).rejects.toBe(error)
    })

    test('a step that throws without being async fails the same way', async () => {
        const { system } = fakeSystem()
        const lifecycle = new LifecycleRunner({
            ...system,
            initManagers() {
                throw new Error('no')
            },
        })

        await expect(lifecycle.run()).rejects.toThrow('no')
        await settle()

        expect(lifecycle.state).toBe('ready')
    })
})

describe('stop()', () => {
    test('stops a running system', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()
        await lifecycle.stop()

        expect(calls.at(-1)).toBe('stopManagers')
        expect(lifecycle.state).toBe('stopped')
    })

    test('waits for the managers to stop', async () => {
        const stop = deferred()
        const { system } = fakeSystem({ stopManagers: () => stop.promise })
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()
        const stopping = lifecycle.stop()
        await settle()

        expect(lifecycle.state).toBe('running')

        stop.resolve()
        await stopping

        expect(lifecycle.state).toBe('stopped')
    })

    test('does nothing the second time', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()
        await lifecycle.stop()
        await lifecycle.stop()

        expect(calls.filter(call => call === 'stopManagers')).toHaveLength(1)
        expect(lifecycle.state).toBe('stopped')
    })

    test('stops a system that never ran', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.stop()

        expect(calls).toEqual(['stopManagers'])
        expect(lifecycle.state).toBe('stopped')
    })

    for (const step of ['connect', 'initManagers', 'startManagers', 'runManagers'] as const) {
        test(`stops after ${step}() failed`, async () => {
            const { system, calls } = fakeSystem({ [step]: failing('no') })
            const lifecycle = new LifecycleRunner(system)

            await expect(lifecycle.run()).rejects.toThrow('no')
            await settle()
            await lifecycle.stop()

            expect(calls.at(-1)).toBe('stopManagers')
            expect(lifecycle.state).toBe('stopped')
        })
    }

    test('a failing stop leaves the state where it was, and can be tried again', async () => {
        let fail = true
        const { system } = fakeSystem({
            stopManagers: async () => {
                if (fail) throw new Error('still busy')
            },
        })
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()

        await expect(lifecycle.stop()).rejects.toThrow('still busy')
        await settle()
        expect(lifecycle.state).toBe('running')

        fail = false
        await lifecycle.stop()

        expect(lifecycle.state).toBe('stopped')
    })

    test('a stopped system can not run again', async () => {
        const { system, calls } = fakeSystem()
        const lifecycle = new LifecycleRunner(system)

        await lifecycle.run()
        await lifecycle.stop()

        await expect(lifecycle.run()).rejects.toBeInstanceOf(TransitionError)
        await settle()
        expect(calls).toHaveLength(5)
        expect(lifecycle.state).toBe('stopped')
    })

    test('is refused while a startup step is still in progress', async () => {
        const init = deferred()
        const { system, calls } = fakeSystem({ initManagers: () => init.promise })
        const lifecycle = new LifecycleRunner(system)

        const running = lifecycle.run()
        await settle()

        await expect(lifecycle.stop()).rejects.toBeInstanceOf(TransitionError)
        await settle()
        expect(calls).not.toContain('stopManagers')

        init.resolve()
        await running

        expect(lifecycle.state).toBe('running')
    })
})
