import { describe, expect, test } from 'bun:test'
import { createMovingAverage, type MovingAverage } from './moving-average.ts'

const INTERVAL = 10

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Resolves once the average is the expected one. Rejects when it still is not after a second. */
const settles = async (average: MovingAverage, expected: number) => {
    const end = Date.now() + 1_000

    while (Math.abs(average.value.value - expected) > 1e-9) {
        if (Date.now() > end) throw new Error(`The average is ${average.value.value}, not ${expected}`)

        await wait(2)
    }
}

describe('createMovingAverage', () => {
    test('begins with the first reading, taken at once', () => {
        const average = createMovingAverage(() => 0.6, { interval: INTERVAL, samples: 4 })

        expect(average.value.value).toBe(0.6)

        average.stop()
    })

    test('is the average of the readings so far while there are fewer than `samples`', async () => {
        const values = [0.2, 0.4]
        let reads = 0
        const average = createMovingAverage(() => values[Math.min(reads++, 1)]!, { interval: INTERVAL, samples: 100 })

        expect(average.value.value).toBe(0.2)

        await wait(INTERVAL * 1.5)

        // 0.2 once, and 0.4 at each reading since
        expect(average.value.value).toBeCloseTo((0.2 + 0.4 * (reads - 1)) / reads)
        expect(reads).toBeGreaterThan(1)

        average.stop()
    })

    test('moves towards a value that stays, and reaches it after `samples` readings', async () => {
        let current = 1
        const average = createMovingAverage(() => current, { interval: INTERVAL, samples: 4 })

        current = 0
        await wait(INTERVAL * 1.5)

        // The first reading of 1 is still among the last four
        expect(average.value.value).toBeGreaterThan(0)
        expect(average.value.value).toBeLessThan(1)

        await settles(average, 0)

        average.stop()
    })

    test('is over the last `samples` readings only', async () => {
        let reads = 0
        // 10 once, then 2 for ever: with two samples the 10 is gone after two more readings
        const average = createMovingAverage(() => (reads++ === 0 ? 10 : 2), { interval: INTERVAL, samples: 2 })

        await settles(average, 2)

        average.stop()
    })

    test('smooths a value that jumps about', async () => {
        let reads = 0
        const average = createMovingAverage(() => (reads++ % 2 === 0 ? 0 : 1), { interval: INTERVAL, samples: 4 })

        await wait(INTERVAL * 6)

        expect(average.value.value).toBe(0.5)

        average.stop()
    })

    test('stop() ends the reading', async () => {
        let reads = 0
        const average = createMovingAverage(() => reads++, { interval: INTERVAL, samples: 4 })

        average.stop()

        const value = average.value.value

        await wait(INTERVAL * 3)

        expect(reads).toBe(1)
        expect(average.value.value).toBe(value)
    })
})
