// The context: the one object the live server's managers and live objects share.
import type { DemoEvents } from '@virtual-infrastructure/protocol/events'
import type { EventBus } from 'live-system/core'
import type { Pinia } from 'pinia'

export interface DemoContext {
    /** How the users and the servers reach each other: neither knows the other. */
    events: EventBus<DemoEvents>
    /** The local reactive state: a store per kind of record, each a projection of the data service. */
    pinia: Pinia
    /** A number from 0 up to, not including, 1. `Math.random`, unless a test gives its own. */
    random: () => number
    /** Multiplies every duration and delay. 1, unless a test wants time to pass faster. */
    timeScale: number
}
