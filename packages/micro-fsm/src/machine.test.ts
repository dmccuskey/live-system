import { describe, expect, test } from 'bun:test'
import { StateMachine, TransitionError } from 'micro-fsm'
import type { MachineConfig } from 'micro-fsm'

type State = 'created' | 'ready' | 'running' | 'stopped'

function lifecycle(states: MachineConfig<State>['states'] = {}): StateMachine<State> {
    return new StateMachine<State>({
        initial: 'created',
        states: {
            ready: { from: 'created' },
            running: { from: 'ready' },
            stopped: { from: '*' },
            ...states,
        },
    })
}

// A promise the test settles by hand, to hold a hook open
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('state', () => {
    test('starts in the initial state', () => {
        expect(lifecycle().state).toBe('created')
    })

    test('is() compares with the current state', async () => {
        const machine = lifecycle()

        expect(machine.is('created')).toBe(true)
        expect(machine.is('ready')).toBe(false)

        await machine.transition('ready')

        expect(machine.is('created')).toBe(false)
        expect(machine.is('ready')).toBe(true)
    })
})

describe('allowed transitions', () => {
    test('a transition from the configured state changes the state', async () => {
        const machine = lifecycle()

        await machine.transition('ready')
        expect(machine.state).toBe('ready')

        await machine.transition('running')
        expect(machine.state).toBe('running')
    })

    test('from may list several states', async () => {
        const states: MachineConfig<State>['states'] = {
            stopped: { from: ['ready', 'running'] },
        }

        const fromReady = lifecycle(states)
        await fromReady.transition('ready')
        await fromReady.transition('stopped')
        expect(fromReady.state).toBe('stopped')

        const fromRunning = lifecycle(states)
        await fromRunning.transition('ready')
        await fromRunning.transition('running')
        await fromRunning.transition('stopped')
        expect(fromRunning.state).toBe('stopped')

        const fromCreated = lifecycle(states)
        expect(fromCreated.can('stopped')).toBe(false)
    })

    test("from '*' allows any state, including the state itself", async () => {
        const machine = lifecycle()

        await machine.transition('stopped')
        expect(machine.state).toBe('stopped')

        await machine.transition('stopped')
        expect(machine.state).toBe('stopped')
    })

    test('a state may be entered from itself when from says so', async () => {
        let entered = 0
        const machine = lifecycle({
            ready: {
                from: ['created', 'ready'],
                enter: () => {
                    entered++
                },
            },
        })

        await machine.transition('ready')
        await machine.transition('ready')

        expect(entered).toBe(2)
    })
})

describe('refused transitions', () => {
    test('a transition from the wrong state is refused and the state is unchanged', async () => {
        const machine = lifecycle()

        await expect(machine.transition('running')).rejects.toThrow(TransitionError)
        expect(machine.state).toBe('created')
    })

    test('the error names the states and the reason', async () => {
        const machine = lifecycle()

        const error = await machine.transition('running').catch((e: unknown) => e)

        expect(error).toBeInstanceOf(TransitionError)
        expect(error).toBeInstanceOf(Error)
        expect(error).toMatchObject({
            name: 'TransitionError',
            from: 'created',
            to: 'running',
            reason: 'not-allowed',
            message: "Cannot transition from 'created' to 'running'",
        })
    })

    test('a state is not entered from itself unless from says so', async () => {
        const machine = lifecycle()
        await machine.transition('ready')

        await expect(machine.transition('ready')).rejects.toThrow(TransitionError)
    })

    test('a state with no entry, or no from, cannot be entered', async () => {
        const machine = lifecycle({ running: { enter: () => {} } })
        await machine.transition('ready')

        expect(machine.can('created')).toBe(false)
        await expect(machine.transition('created')).rejects.toThrow(TransitionError)
        expect(machine.can('running')).toBe(false)
        await expect(machine.transition('running')).rejects.toThrow(TransitionError)
    })

    test('a name that is not a configured state is refused', async () => {
        const machine = lifecycle()

        // What a caller without types could pass
        for (const name of ['nowhere', 'toString', 'constructor', '__proto__']) {
            expect(machine.can(name as State)).toBe(false)
            await expect(machine.transition(name as State)).rejects.toThrow(TransitionError)
        }
        expect(machine.state).toBe('created')
    })

    test('no hook runs for a refused transition', async () => {
        const calls: string[] = []
        const machine = lifecycle({
            created: { leave: () => void calls.push('leave created') },
            running: { from: 'ready', enter: () => void calls.push('enter running') },
        })

        await machine.transition('running').catch(() => {})

        expect(calls).toEqual([])
    })
})

describe('can()', () => {
    test('says whether a transition would be accepted', async () => {
        const machine = lifecycle()

        expect(machine.can('ready')).toBe(true)
        expect(machine.can('running')).toBe(false)
        expect(machine.can('stopped')).toBe(true)

        await machine.transition('ready')

        expect(machine.can('ready')).toBe(false)
        expect(machine.can('running')).toBe(true)
    })

    test('runs no hooks and changes nothing', () => {
        let entered = 0
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: () => {
                    entered++
                },
            },
        })

        machine.can('ready')

        expect(entered).toBe(0)
        expect(machine.state).toBe('created')
    })
})

describe('enter', () => {
    test('is awaited before the state changes', async () => {
        const gate = deferred()
        let stateInsideEnter: State | undefined
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: async () => {
                    stateInsideEnter = machine.state
                    await gate.promise
                },
            },
        })

        let settled = false
        const done = machine.transition('ready').then(() => {
            settled = true
        })

        await Promise.resolve()
        expect(stateInsideEnter).toBe('created')
        expect(machine.state).toBe('created')
        expect(settled).toBe(false)

        gate.resolve()
        await done

        expect(machine.state).toBe('ready')
    })

    test('is told where the transition comes from and goes to', async () => {
        const seen: unknown[] = []
        const machine = lifecycle({
            stopped: { from: '*', enter: transition => void seen.push(transition) },
        })

        await machine.transition('ready')
        await machine.transition('stopped')

        expect(seen).toEqual([{ from: 'ready', to: 'stopped' }])
    })

    test('a failing enter leaves the state unchanged and passes its error on', async () => {
        const failure = new Error('database unreachable')
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: async () => {
                    throw failure
                },
            },
        })

        await expect(machine.transition('ready')).rejects.toBe(failure)
        await Promise.resolve()
        expect(machine.state).toBe('created')
    })

    test('an enter that throws synchronously is handled the same way', async () => {
        const failure = new Error('bad configuration')
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: () => {
                    throw failure
                },
            },
        })

        const error = await machine.transition('ready').catch((e: unknown) => e)

        expect(error).toBe(failure)
        expect(machine.state).toBe('created')
    })

    test('the transition can be tried again after a failure', async () => {
        let attempts = 0
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: () => {
                    if (++attempts === 1) throw new Error('not yet')
                },
            },
        })

        await machine.transition('ready').catch(() => {})
        expect(machine.can('ready')).toBe(true)

        await machine.transition('ready')
        expect(machine.state).toBe('ready')
        expect(attempts).toBe(2)
    })
})

describe('leave', () => {
    test('runs for the state being left, before the enter of the target', async () => {
        const calls: string[] = []
        const machine = lifecycle({
            created: { leave: () => void calls.push(`leave created in ${machine.state}`) },
            ready: {
                from: 'created',
                enter: () => void calls.push(`enter ready in ${machine.state}`),
                leave: () => void calls.push('leave ready'),
            },
        })

        await machine.transition('ready')

        expect(calls).toEqual(['leave created in created', 'enter ready in created'])
    })

    test('is awaited before enter runs', async () => {
        const gate = deferred()
        let entered = false
        const machine = lifecycle({
            created: { leave: () => gate.promise },
            ready: {
                from: 'created',
                enter: () => {
                    entered = true
                },
            },
        })

        const done = machine.transition('ready')

        await Promise.resolve()
        expect(entered).toBe(false)
        expect(machine.state).toBe('created')

        gate.resolve()
        await done

        expect(entered).toBe(true)
        expect(machine.state).toBe('ready')
    })

    test('is told where the transition comes from and goes to', async () => {
        const seen: unknown[] = []
        const machine = lifecycle({
            created: { leave: transition => void seen.push(transition) },
        })

        await machine.transition('stopped')

        expect(seen).toEqual([{ from: 'created', to: 'stopped' }])
    })

    test('a failing leave leaves the state unchanged and enter does not run', async () => {
        const failure = new Error('still busy')
        let entered = false
        const machine = lifecycle({
            created: {
                leave: async () => {
                    throw failure
                },
            },
            ready: {
                from: 'created',
                enter: () => {
                    entered = true
                },
            },
        })

        const error = await machine.transition('ready').catch((e: unknown) => e)

        expect(error).toBe(failure)
        expect(entered).toBe(false)
        expect(machine.state).toBe('created')
    })
})

describe('one transition at a time', () => {
    test('a transition started while another is in progress is refused', async () => {
        const gate = deferred()
        const machine = lifecycle({
            ready: { from: 'created', enter: () => gate.promise },
        })

        const first = machine.transition('ready')

        expect(machine.can('stopped')).toBe(false)
        const error = await machine.transition('stopped').catch((e: unknown) => e)

        expect(error).toBeInstanceOf(TransitionError)
        expect(error).toMatchObject({ from: 'created', to: 'stopped', reason: 'in-transition' })

        gate.resolve()
        await first

        expect(machine.state).toBe('ready')
        expect(machine.can('stopped')).toBe(true)
    })

    test('an enter that calls transition is refused', async () => {
        let inner: unknown
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: async () => {
                    inner = await machine.transition('stopped').catch((e: unknown) => e)
                },
            },
        })

        await machine.transition('ready')

        expect(inner).toBeInstanceOf(TransitionError)
        expect(machine.state).toBe('ready')
    })

    test('the machine accepts transitions again after a failed one', async () => {
        const machine = lifecycle({
            ready: {
                from: 'created',
                enter: () => {
                    throw new Error('failed')
                },
            },
        })

        await machine.transition('ready').catch(() => {})
        await machine.transition('stopped')

        expect(machine.state).toBe('stopped')
    })
})

describe('independence', () => {
    test('two machines from the same configuration do not share state', async () => {
        const config: MachineConfig<State> = {
            initial: 'created',
            states: { ready: { from: 'created' } },
        }
        const one = new StateMachine(config)
        const two = new StateMachine(config)

        await one.transition('ready')

        expect(one.state).toBe('ready')
        expect(two.state).toBe('created')
    })
})
