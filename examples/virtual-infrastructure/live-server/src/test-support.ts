// What the live server's tests share: a context, a system around a manager, and waiting.
import type { CommandFinishedEvent, DemoEvents } from '@virtual-infrastructure/protocol/events'
import { EventBus, LiveSystem } from 'live-system/core'
import type { BaseManager, Command, CommandResponse } from 'live-system/core'
import { Router } from 'live-system/server'
import type { DemoContext } from './context.ts'

/** Durations in the tests are a hundredth of the real ones: a search command runs for 20 ms. */
export const TIME_SCALE = 0.01

export function createContext(overrides: Partial<DemoContext> = {}): DemoContext {
    return {
        events: new EventBus<DemoEvents>(),
        random: () => 0.5,
        timeScale: TIME_SCALE,
        ...overrides,
    }
}

/** A booted system around the managers the factories make, with a router for their routes. */
export async function bootSystem<M extends BaseManager<DemoContext>[]>(
    factories: { [K in keyof M]: (context: DemoContext) => M[K] },
    overrides: Partial<DemoContext> = {},
) {
    const router = new Router()
    const context = createContext(overrides)
    const system = new LiveSystem<DemoContext>({ context, router })
    const managers = factories.map(factory => system.addManager(factory)) as M

    await system.boot()

    return {
        system,
        context,
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

/** Resolves once the condition holds. Rejects when it does not within the timeout. */
export async function until(condition: () => boolean, timeout = 2000): Promise<void> {
    const end = Date.now() + timeout

    while (!condition()) {
        if (Date.now() > end) throw new Error('The condition did not come to hold in time')
        await Bun.sleep(2)
    }
}
