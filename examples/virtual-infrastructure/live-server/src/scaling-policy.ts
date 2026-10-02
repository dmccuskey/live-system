// ScalingPolicy: decides from samples of the utilization when a server is to be added or removed.
import {
    MIN_SCALE_DOWN_UTILIZATION,
    SCALE_DOWN_GAP,
    SCALE_DOWN_WINDOW,
    SCALE_UP_WINDOW,
    SCALING_SAMPLE_INTERVAL,
} from '@virtual-infrastructure/protocol/servers/servers.constants'

export type ScalingDecision = 'up' | 'down' | undefined

export interface ScalingSample {
    /** The load over the capacity, a fraction from 0 to 1. */
    utilization: number
    /** Whether commands wait for room: demand beyond the capacity, which the utilization cannot show. */
    isQueued: boolean
    /** The utilization above which capacity is to be added. */
    maxUtilization: number
}

/** What decides on scaling: the `ScalingPolicy`, or a test's own. */
export type ScalingDecider = Pick<ScalingPolicy, 'sample' | 'reset'>

// How many samples in a row make a window
const UP_SAMPLES = Math.ceil(SCALE_UP_WINDOW / SCALING_SAMPLE_INTERVAL)
const DOWN_SAMPLES = Math.ceil(SCALE_DOWN_WINDOW / SCALING_SAMPLE_INTERVAL)

/** The utilization below which capacity is to be removed: a fixed gap below the maximum. */
export function scaleDownMark(maxUtilization: number): number {
    return Math.max(MIN_SCALE_DOWN_UTILIZATION, maxUtilization - SCALE_DOWN_GAP)
}

/**
 * Hysteresis over time. A decision needs every sample of its window on the
 * same side: above the maximum to scale up, below the lower mark to scale
 * down. Between the two nothing happens. A decision begins both windows anew,
 * so the next one waits for its full window.
 */
export class ScalingPolicy {
    // How many samples in a row were above the maximum, and below the lower mark
    #above = 0
    #below = 0

    sample({ utilization, isQueued, maxUtilization }: ScalingSample): ScalingDecision {
        const isAbove = isQueued || utilization > maxUtilization
        const isBelow = !isQueued && utilization < scaleDownMark(maxUtilization)

        this.#above = isAbove ? this.#above + 1 : 0
        this.#below = isBelow ? this.#below + 1 : 0

        if (this.#above >= UP_SAMPLES) {
            this.reset()
            return 'up'
        }

        if (this.#below >= DOWN_SAMPLES) {
            this.reset()
            return 'down'
        }

        return undefined
    }

    /** Forgets the samples so far. */
    reset(): void {
        this.#above = 0
        this.#below = 0
    }
}
