// ScalingPolicy: averages samples of the load, and decides from the average when a server is to be added or removed.
import {
    SCALE_DOWN_MARGIN,
    SCALE_DOWN_WAIT,
    SCALE_UP_MARGIN,
    SCALE_UP_WAIT,
    SCALING_SAMPLE_INTERVAL,
    UTILIZATION_WINDOW,
} from '@virtual-infrastructure/protocol/servers/servers.constants'

export type ScalingDecision = 'up' | 'down' | undefined

export interface ScalingSample {
    /** The load of the servers that take commands, in capacity units. */
    load: number
    /** The cost of the commands that wait for room: demand beyond the capacity, which the load cannot show. */
    waiting: number
    /** The capacity of the servers that take commands. */
    capacity: number
    /** The utilization above which capacity is to be added. */
    maxUtilization: number
}

/** What decides on scaling: the `ScalingPolicy`, or a test's own. */
export type ScalingDecider = Pick<ScalingPolicy, 'sample' | 'reset' | 'utilization'>

// How many samples the average is over, and how many there must be after a decision before the next
const AVERAGE_SAMPLES = Math.ceil(UTILIZATION_WINDOW / SCALING_SAMPLE_INTERVAL)
const UP_SAMPLES = Math.ceil(SCALE_UP_WAIT / SCALING_SAMPLE_INTERVAL)
const DOWN_SAMPLES = Math.ceil(SCALE_DOWN_WAIT / SCALING_SAMPLE_INTERVAL)

// The demand over the capacity, beyond 1 when commands wait for room. No capacity counts as full.
const ratioOf = (demand: number, capacity: number): number => (capacity === 0 ? 1 : demand / capacity)

/**
 * The demand is the load and what waits for room. Its average over the last
 * samples, taken over the capacity there is now, is the utilization: a server
 * added or removed shows in it at once, a change of the load only gradually.
 *
 * The utilization is kept in a band around the maximum: a server is to be
 * added above the band, and removed below it when nothing waits for room.
 * The decision goes by the demand beyond the capacity too, which the
 * utilization, at most 1, cannot show. After a decision the next one waits,
 * an addition less long than a removal.
 */
export class ScalingPolicy {
    // The demand of the last samples, the oldest first
    #demands: number[] = []
    // The capacity of the last sample
    #capacity = 0
    // How many samples there were since the last decision
    #sinceDecision = 0

    /** The average demand over the capacity of the last sample, a fraction from 0 to 1. Before the first sample, 0. */
    get utilization(): number {
        return this.#demands.length === 0 ? 0 : Math.min(1, ratioOf(this.#demand(), this.#capacity))
    }

    sample({ load, waiting, capacity, maxUtilization }: ScalingSample): ScalingDecision {
        this.#demands.push(load + waiting)

        if (this.#demands.length > AVERAGE_SAMPLES) this.#demands.shift()

        this.#capacity = capacity
        this.#sinceDecision++

        const ratio = ratioOf(this.#demand(), capacity)
        const isAbove = ratio > maxUtilization + SCALE_UP_MARGIN
        const isBelow = waiting === 0 && ratio < maxUtilization - SCALE_DOWN_MARGIN

        if (isAbove && this.#sinceDecision >= UP_SAMPLES) {
            this.reset()
            return 'up'
        }

        if (isBelow && this.#sinceDecision >= DOWN_SAMPLES) {
            this.reset()
            return 'down'
        }

        return undefined
    }

    /** Begins the wait for the next decision anew. The average stays. */
    reset(): void {
        this.#sinceDecision = 0
    }

    #demand(): number {
        return this.#demands.reduce((sum, demand) => sum + demand, 0) / this.#demands.length
    }
}
