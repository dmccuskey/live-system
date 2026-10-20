// The context: the one object the live server's managers and live objects share.
import type { DemoEvents } from '@virtual-infrastructure/protocol/events'
import type { Clock, EventBus } from 'live-system/core'
import type { DemoStores } from './stores.ts'

export interface DemoContext {
    /** The time and the timers of the simulation. Real time, unless it is scaled or a test gives its own. */
    clock: Clock
    /** How the users and the servers reach each other: neither knows the other. */
    events: EventBus<DemoEvents>
    /** The local reactive state: a store per kind of record, each a projection of the data service. */
    stores: DemoStores
    /** A number from 0 up to, not including, 1. `Math.random`, unless a test gives its own. */
    random: () => number
}
