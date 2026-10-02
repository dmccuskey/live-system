import { describe, expect, test } from 'bun:test'
import { BaseManager, EventBus, LiveObject } from 'live-system/core'
import type { Unsubscribe } from 'live-system/core'

// The events of an application, as it would define them
interface TestEvents {
    'server.overloaded': { serverId: string; load: number }
    'server.drained': { serverId: string }
    'system.idle': void
}

interface TestContext {
    events: EventBus<TestEvents>
}

describe('on() and emit()', () => {
    test('a listener receives the payload', () => {
        const events = new EventBus<TestEvents>()
        const received: TestEvents['server.overloaded'][] = []

        events.on('server.overloaded', event => received.push(event))
        events.emit('server.overloaded', { serverId: '42', load: 0.9 })

        expect(received).toEqual([{ serverId: '42', load: 0.9 }])
    })

    test('an event with a void payload is emitted without one', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0

        events.on('system.idle', () => (heard += 1))
        events.emit('system.idle')

        expect(heard).toBe(1)
    })

    test('a listener hears only its own event', () => {
        const events = new EventBus<TestEvents>()
        const heard: string[] = []

        events.on('server.overloaded', () => heard.push('overloaded'))
        events.on('server.drained', () => heard.push('drained'))
        events.emit('server.drained', { serverId: '42' })

        expect(heard).toEqual(['drained'])
    })

    test('several listeners are called in the order they subscribed', () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []

        events.on('system.idle', () => calls.push('first'))
        events.on('system.idle', () => calls.push('second'))
        events.on('system.idle', () => calls.push('third'))
        events.emit('system.idle')

        expect(calls).toEqual(['first', 'second', 'third'])
    })

    test('delivery is synchronous', () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []

        events.on('system.idle', () => calls.push('listener'))
        events.emit('system.idle')
        calls.push('after emit')

        expect(calls).toEqual(['listener', 'after emit'])
    })

    test('emitting an event nobody listens to does nothing', () => {
        const events = new EventBus<TestEvents>()

        expect(() => events.emit('system.idle')).not.toThrow()
    })

    test('the names and payloads are checked against the event map', () => {
        const events = new EventBus<TestEvents>()

        // @ts-expect-error an unknown event
        events.on('server.exploded', () => {})
        // @ts-expect-error a payload of the wrong shape
        events.emit('server.drained', { load: 1 })
        // @ts-expect-error a missing payload
        events.emit('server.drained')
        // @ts-expect-error a payload where there is none
        events.emit('system.idle', { serverId: '42' })

        expect(events.listenerCount('server.drained')).toBe(0)
    })

    test('two buses share nothing', () => {
        const one = new EventBus<TestEvents>()
        const other = new EventBus<TestEvents>()
        let heard = 0

        one.on('system.idle', () => (heard += 1))
        other.emit('system.idle')

        expect(heard).toBe(0)
    })
})

describe('unsubscribing', () => {
    test('the function on() returns ends the subscription', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0

        const unsubscribe = events.on('system.idle', () => (heard += 1))

        events.emit('system.idle')
        unsubscribe()
        events.emit('system.idle')

        expect(heard).toBe(1)
    })

    test('ends only its own subscription', () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []

        const unsubscribe = events.on('system.idle', () => calls.push('first'))
        events.on('system.idle', () => calls.push('second'))

        unsubscribe()
        events.emit('system.idle')

        expect(calls).toEqual(['second'])
    })

    test('calling it again does nothing', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0
        const listener = () => {
            heard += 1
        }

        const unsubscribe = events.on('system.idle', listener)
        events.on('system.idle', listener)

        unsubscribe()
        unsubscribe()
        events.emit('system.idle')

        expect(heard).toBe(1)
    })

    test('the same function subscribed twice is two subscriptions', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0
        const listener = () => {
            heard += 1
        }

        events.on('system.idle', listener)
        events.on('system.idle', listener)
        events.emit('system.idle')

        expect(heard).toBe(2)
        expect(events.listenerCount('system.idle')).toBe(2)
    })

    test('a listener unsubscribed during delivery is still called for that event', () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []
        let unsubscribeSecond: Unsubscribe = () => {}

        events.on('system.idle', () => {
            calls.push('first')
            unsubscribeSecond()
        })
        unsubscribeSecond = events.on('system.idle', () => calls.push('second'))

        events.emit('system.idle')
        events.emit('system.idle')

        expect(calls).toEqual(['first', 'second', 'first'])
    })

    test('a listener subscribed during delivery waits for the next event', () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []

        events.once('system.idle', () => {
            calls.push('first')
            events.on('system.idle', () => calls.push('late'))
        })

        events.emit('system.idle')
        expect(calls).toEqual(['first'])

        events.emit('system.idle')
        expect(calls).toEqual(['first', 'late'])
    })
})

describe('once()', () => {
    test('hears the next event only', () => {
        const events = new EventBus<TestEvents>()
        const received: string[] = []

        events.once('server.drained', event => received.push(event.serverId))
        events.emit('server.drained', { serverId: '1' })
        events.emit('server.drained', { serverId: '2' })

        expect(received).toEqual(['1'])
        expect(events.listenerCount('server.drained')).toBe(0)
    })

    test('can be unsubscribed before the event', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0

        const unsubscribe = events.once('system.idle', () => (heard += 1))

        unsubscribe()
        events.emit('system.idle')

        expect(heard).toBe(0)
    })

    test('is called once even when it emits the same event', () => {
        const events = new EventBus<TestEvents>()
        let heard = 0

        events.once('system.idle', () => {
            heard += 1
            events.emit('system.idle')
        })
        events.emit('system.idle')

        expect(heard).toBe(1)
    })
})

describe('a listener that fails', () => {
    test('stops neither the other listeners nor the emitter', () => {
        const errors: unknown[] = []
        const events = new EventBus<TestEvents>({ onError: error => errors.push(error) })
        const failure = new Error('broken listener')
        const calls: string[] = []

        events.on('system.idle', () => calls.push('first'))
        events.on('system.idle', () => {
            throw failure
        })
        events.on('system.idle', () => calls.push('third'))

        expect(() => events.emit('system.idle')).not.toThrow()
        expect(calls).toEqual(['first', 'third'])
        expect(errors).toEqual([failure])
    })

    test('onError is told which event it was', () => {
        const names: (keyof TestEvents)[] = []
        const events = new EventBus<TestEvents>({ onError: (_error, name) => names.push(name) })

        events.on('server.drained', () => {
            throw new Error('broken listener')
        })
        events.emit('server.drained', { serverId: '42' })

        expect(names).toEqual(['server.drained'])
    })

    test('the rejection of an async listener goes to onError', async () => {
        const errors: unknown[] = []
        const events = new EventBus<TestEvents>({ onError: error => errors.push(error) })
        const failure = new Error('broken async listener')

        events.on('system.idle', async () => {
            throw failure
        })
        events.emit('system.idle')

        expect(errors).toEqual([])

        await Promise.resolve()
        await Promise.resolve()

        expect(errors).toEqual([failure])
    })

    test('an async listener is not awaited', async () => {
        const events = new EventBus<TestEvents>()
        const calls: string[] = []

        events.on('system.idle', async () => {
            await Promise.resolve()
            calls.push('async listener done')
        })
        events.emit('system.idle')
        calls.push('after emit')

        await Promise.resolve()
        await Promise.resolve()

        expect(calls).toEqual(['after emit', 'async listener done'])
    })

    test('is logged with console.error when no onError is given', () => {
        const events = new EventBus<TestEvents>()
        const failure = new Error('broken listener')
        const logged: unknown[][] = []
        const original = console.error

        console.error = (...args: unknown[]) => {
            logged.push(args)
        }

        try {
            events.on('system.idle', () => {
                throw failure
            })
            events.emit('system.idle')
        } finally {
            console.error = original
        }

        expect(logged).toHaveLength(1)
        expect(logged[0]).toContain(failure)
        expect(String(logged[0]?.[0])).toContain('system.idle')
    })
})

describe('listenerCount()', () => {
    test('counts the listeners of one event', () => {
        const events = new EventBus<TestEvents>()

        expect(events.listenerCount('system.idle')).toBe(0)

        const unsubscribe = events.on('system.idle', () => {})
        events.on('system.idle', () => {})
        events.on('server.drained', () => {})

        expect(events.listenerCount('system.idle')).toBe(2)

        unsubscribe()

        expect(events.listenerCount('system.idle')).toBe(1)
    })
})

describe('cleanup by the subscriber', () => {
    // A manager that listens while it runs
    class WatchManager extends BaseManager<TestContext> {
        overloaded: string[] = []
        #unsubscribe: Unsubscribe | undefined

        override async start(): Promise<void> {
            this.#unsubscribe = this.context.events.on('server.overloaded', event => {
                this.overloaded.push(event.serverId)
            })
        }

        override async stop(): Promise<void> {
            this.#unsubscribe?.()
            this.#unsubscribe = undefined
        }
    }

    // A live object that listens for as long as it exists
    class Watcher extends LiveObject {
        drained: string[] = []
        #unsubscribe: Unsubscribe

        constructor(events: EventBus<TestEvents>) {
            super()
            this.#unsubscribe = events.on('server.drained', event => {
                this.drained.push(event.serverId)
            })
        }

        protected override release(): void {
            this.#unsubscribe()
        }
    }

    test('a manager given its own bus releases its listener in stop()', async () => {
        const events = new EventBus<TestEvents>()
        const manager = new WatchManager({ events })

        await manager.start()
        events.emit('server.overloaded', { serverId: '1', load: 0.9 })

        expect(events.listenerCount('server.overloaded')).toBe(1)

        await manager.stop()
        events.emit('server.overloaded', { serverId: '2', load: 0.9 })

        expect(manager.overloaded).toEqual(['1'])
        expect(events.listenerCount('server.overloaded')).toBe(0)
    })

    test('a live object releases its listener in destroy()', () => {
        const events = new EventBus<TestEvents>()
        const watcher = new Watcher(events)

        events.emit('server.drained', { serverId: '1' })
        watcher.destroy()
        events.emit('server.drained', { serverId: '2' })

        expect(watcher.drained).toEqual(['1'])
        expect(events.listenerCount('server.drained')).toBe(0)
    })
})
