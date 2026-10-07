import { describe, expect, test } from 'bun:test'
import { FakeClock, scaledClock, systemClock } from 'live-system/core'

describe('FakeClock', () => {
    test('time stands still until it is advanced', async () => {
        const clock = new FakeClock()
        const before = clock.now()

        await new Promise(resolve => setTimeout(resolve, 5))

        expect(clock.now()).toBe(before)

        await clock.advance(250)

        expect(clock.now()).toBe(before + 250)
    })

    test('after() runs once, when its delay has passed', async () => {
        const clock = new FakeClock()
        let calls = 0

        clock.after(100, () => calls++)

        await clock.advance(99)
        expect(calls).toBe(0)

        await clock.advance(1)
        expect(calls).toBe(1)

        await clock.advance(1000)
        expect(calls).toBe(1)
        expect(clock.pendingCount).toBe(0)
    })

    test('a timer sees its own time, not the end of the advance', async () => {
        const clock = new FakeClock()
        const seen: number[] = []

        clock.after(100, () => seen.push(clock.now()))
        clock.after(30, () => seen.push(clock.now()))

        await clock.advance(500)

        expect(seen).toEqual([30, 100])
        expect(clock.now()).toBe(500)
    })

    test('timers due at the same time run in the order they were set', async () => {
        const clock = new FakeClock()
        const order: string[] = []

        clock.after(10, () => order.push('first'))
        clock.after(10, () => order.push('second'))
        clock.after(5, () => order.push('earlier'))

        await clock.advance(10)

        expect(order).toEqual(['earlier', 'first', 'second'])
    })

    test('every() runs at each interval until it is cancelled', async () => {
        const clock = new FakeClock()
        const seen: number[] = []
        const cancel = clock.every(100, () => seen.push(clock.now()))

        await clock.advance(350)
        expect(seen).toEqual([100, 200, 300])

        cancel()
        await clock.advance(1000)

        expect(seen).toEqual([100, 200, 300])
        expect(clock.pendingCount).toBe(0)
    })

    test('every() refuses an interval that is not more than 0', () => {
        const clock = new FakeClock()

        expect(() => clock.every(0, () => {})).toThrow(RangeError)
        expect(() => clock.every(Number.NaN, () => {})).toThrow(RangeError)
    })

    test('a cancelled timer never runs, and cancelling again does nothing', async () => {
        const clock = new FakeClock()
        let calls = 0
        const cancel = clock.after(10, () => calls++)

        cancel()
        cancel()
        await clock.advance(100)

        expect(calls).toBe(0)
    })

    test('a timer may cancel one that is due later in the same advance', async () => {
        const clock = new FakeClock()
        let calls = 0
        const cancel = clock.after(20, () => calls++)

        clock.after(10, cancel)
        await clock.advance(100)

        expect(calls).toBe(0)
    })

    test('a timer set by a timer runs within the same advance, at its own time', async () => {
        const clock = new FakeClock()
        const seen: number[] = []

        clock.after(10, () => {
            clock.after(10, () => seen.push(clock.now()))
        })
        await clock.advance(100)

        expect(seen).toEqual([20])
    })

    test('a timer set after an awaited step of a timer runs within the same advance', async () => {
        const clock = new FakeClock()
        const seen: number[] = []

        clock.after(10, async () => {
            await Promise.resolve()
            await Promise.resolve()
            clock.after(10, () => seen.push(clock.now()))
        })
        await clock.advance(100)

        expect(seen).toEqual([20])
    })

    test('a delay of 0 or less runs on the next advance, even one of 0', async () => {
        const clock = new FakeClock()
        let calls = 0

        clock.after(0, () => calls++)
        clock.after(-5, () => calls++)

        expect(calls).toBe(0)

        await clock.advance(0)

        expect(calls).toBe(2)
    })

    test('advance() rejects with what a timer throws, and keeps the timers after it', async () => {
        const clock = new FakeClock()
        let calls = 0

        clock.after(10, () => {
            throw new Error('timer failed')
        })
        clock.after(20, () => calls++)

        expect(clock.advance(100)).rejects.toThrow('timer failed')
        await clock.advance(100)

        expect(calls).toBe(1)
    })
})

describe('FakeClock.advanceToNext()', () => {
    test('moves to the timer due first and runs only that one', async () => {
        const clock = new FakeClock()
        const order: string[] = []

        clock.after(5000, () => order.push('later'))
        clock.after(2000, () => order.push('first'))

        expect(await clock.advanceToNext()).toBe(true)
        expect(order).toEqual(['first'])
        expect(clock.now()).toBe(2000)

        expect(await clock.advanceToNext()).toBe(true)
        expect(order).toEqual(['first', 'later'])
        expect(clock.now()).toBe(5000)
    })

    test('resolves with false, and leaves the time alone, when no timer waits', async () => {
        const clock = new FakeClock()

        await clock.advance(10)

        expect(await clock.advanceToNext()).toBe(false)
        expect(clock.now()).toBe(10)
    })

    test('an interval is always next again', async () => {
        const clock = new FakeClock()
        let calls = 0

        clock.every(100, () => calls++)
        await clock.advanceToNext()
        await clock.advanceToNext()

        expect(calls).toBe(2)
        expect(clock.now()).toBe(200)
    })

    test('a timer set by what settles first is found', async () => {
        const clock = new FakeClock()
        let calls = 0

        Promise.resolve().then(() => clock.after(10, () => calls++))

        expect(await clock.advanceToNext()).toBe(true)
        expect(calls).toBe(1)
    })
})

describe('scaledClock()', () => {
    test('multiplies every delay and interval, and reads the time to match', async () => {
        const base = new FakeClock()
        const clock = scaledClock(base, 0.01)
        const seen: number[] = []

        clock.after(1000, () => seen.push(clock.now()))

        const cancel = clock.every(300, () => seen.push(clock.now()))

        await base.advance(9)
        expect(seen).toEqual([300, 600, 900])

        await base.advance(1)
        expect(seen).toEqual([300, 600, 900, 1000])
        expect(clock.now()).toBe(1000)

        cancel()
        await base.advance(100)
        expect(seen).toHaveLength(4)
    })

    test('a cancelled timer never runs', async () => {
        const base = new FakeClock()
        let calls = 0

        scaledClock(base, 2).after(10, () => calls++)()
        await base.advance(100)

        expect(calls).toBe(0)
    })

    test('refuses a scale that is not more than 0', () => {
        expect(() => scaledClock(new FakeClock(), 0)).toThrow(RangeError)
        expect(() => scaledClock(new FakeClock(), -1)).toThrow(RangeError)
        expect(() => scaledClock(new FakeClock(), Number.NaN)).toThrow(RangeError)
    })
})

describe('systemClock', () => {
    test('now() moves with real time', async () => {
        const before = systemClock.now()

        await new Promise(resolve => setTimeout(resolve, 5))

        expect(systemClock.now()).toBeGreaterThan(before)
    })

    test('after() runs once, and not when it is cancelled', async () => {
        let calls = 0
        const cancel = systemClock.after(1, () => calls++)

        systemClock.after(1, () => calls++)
        cancel()
        await new Promise(resolve => setTimeout(resolve, 30))

        expect(calls).toBe(1)
    })

    test('every() runs until it is cancelled', async () => {
        let calls = 0
        const cancel = systemClock.every(1, () => calls++)

        // However slowly the process runs: the test's own timeout is the limit
        while (calls < 2) await new Promise(resolve => setTimeout(resolve, 1))
        cancel()

        const counted = calls

        await new Promise(resolve => setTimeout(resolve, 20))

        expect(calls).toBe(counted)
    })
})
