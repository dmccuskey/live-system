// What the live server's tests share: a context, a system around a manager, and waiting.
import type { CommandFinishedEvent, DemoEvents } from '@virtual-infrastructure/protocol/events'
import { EventBus, FakeClock, LiveSystem } from 'live-system/core'
import type { BaseManager, Command, CommandResponse } from 'live-system/core'
import { Router } from 'live-system/server'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'

/** A context whose clock stands still until the test moves it. */
export interface TestContext extends DemoContext {
    clock: FakeClock
}

export function createContext(overrides: Partial<Omit<DemoContext, 'clock'>> = {}): TestContext {
    return {
        clock: new FakeClock(),
        events: new EventBus<DemoEvents>(),
        pinia: createPinia(),
        random: () => 0.5,
        ...overrides,
    }
}

/** A booted system around the managers the factories make, with a router for their routes. */
export async function bootSystem<M extends BaseManager<DemoContext>[]>(
    factories: { [K in keyof M]: (context: DemoContext) => M[K] },
    overrides: Partial<Omit<DemoContext, 'clock'>> = {},
) {
    const router = new Router()
    const context = createContext(overrides)
    const system = new LiveSystem<DemoContext>({ context, router })
    const managers = factories.map(factory => system.addManager(factory)) as M

    await system.boot()

    return {
        system,
        context,
        clock: context.clock,
        managers,
        send: <R = unknown>(command: Command) => router.handle(command) as Promise<CommandResponse<R>>,
    }
}

/** Every event of one name from here on. */
export function collect<K extends keyof DemoEvents>(events: EventBus<DemoEvents>, name: K): DemoEvents[K][] {
    const collected: DemoEvents[K][] = []

    events.on(name, event => {
        collected.push(event)
    })

    return collected
}

/** Every `commandFinished` event from here on. */
export function finishedEvents(context: DemoContext): CommandFinishedEvent[] {
    return collect(context.events, 'commandFinished')
}

/**
 * Moves the clock on from timer to timer until the condition holds. Rejects
 * when it does not within `limit` milliseconds of the clock, or no timer is left.
 */
export async function advanceUntil(clock: FakeClock, condition: () => boolean, limit = 600_000): Promise<void> {
    const end = clock.now() + limit

    await clock.advance(0)

    while (!condition()) {
        if (clock.now() >= end) throw new Error(`The condition did not come to hold in ${limit} ms of the clock`)
        if (!(await clock.advanceToNext())) throw new Error('The condition does not hold, and no timer is left to run')
    }
}

/**
 * For a system that reaches its records over a network: moves the clock on
 * from timer to timer, with a moment of real time after each for what it sent
 * to arrive, until the condition holds. Rejects when it does not within the
 * timeout, which is in real time.
 */
export async function advanceUntilArrived(clock: FakeClock, condition: () => boolean, timeout = 2000): Promise<void> {
    const end = Date.now() + timeout

    while (!condition()) {
        if (Date.now() > end) throw new Error('The condition did not come to hold in time')
        await clock.advanceToNext()
        await Bun.sleep(2)
    }
}
