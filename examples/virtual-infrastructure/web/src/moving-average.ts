// A moving average: what smooths a value that jumps about, for the UI to show.
import { readonly, ref } from 'vue'
import type { Ref } from 'vue'

export interface MovingAverageOptions {
    /** How often the value is read, in milliseconds. */
    interval: number
    /** How many readings the average is over. */
    samples: number
}

export interface MovingAverage {
    /** The average of the last readings: of fewer than `samples` until there are that many. */
    readonly value: Readonly<Ref<number>>
    /** Stops reading. The owner calls it at the end of its own life. */
    stop(): void
}

/**
 * Reads a value at an interval and keeps the average of the last readings.
 * It reads by the clock, not at each change, so a value that stays where it
 * is pulls the average towards itself.
 */
export function createMovingAverage(read: () => number, { interval, samples }: MovingAverageOptions): MovingAverage {
    const readings: number[] = []
    const value = ref(0)

    function sample(): void {
        readings.push(read())

        if (readings.length > samples) readings.shift()

        value.value = readings.reduce((sum, reading) => sum + reading, 0) / readings.length
    }

    sample()

    const timer = setInterval(sample, interval)

    return { value: readonly(value), stop: () => clearInterval(timer) }
}
