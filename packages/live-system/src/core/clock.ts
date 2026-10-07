// Clock: where the time and the timers come from, so a test can give its own.

/** Ends a timer. Does nothing when the timer has already run or been cancelled. */
export type CancelTimer = () => void

export interface Clock {
    /** Milliseconds from a start that means nothing: only the difference between two readings does. */
    now(): number
    /** Calls `fn` once, `delay` milliseconds from now. */
    after(delay: number, fn: () => void): CancelTimer
    /** Calls `fn` every `interval` milliseconds, the first time one interval from now. */
    every(interval: number, fn: () => void): CancelTimer
}

/** Real time: `performance.now()`, `setTimeout` and `setInterval`. */
export const systemClock: Clock = {
    now: () => performance.now(),
    after(delay, fn) {
        const timer = setTimeout(fn, delay)

        return () => clearTimeout(timer)
    },
    every(interval, fn) {
        const timer = setInterval(fn, interval)

        return () => clearInterval(timer)
    },
}

/**
 * A clock that multiplies every delay and interval of `clock` by `scale`, and
 * reads its time to match: with a scale of 0.01, a second on it passes in 10
 * milliseconds of `clock`.
 */
export function scaledClock(clock: Clock, scale: number): Clock {
    if (!(scale > 0) || !Number.isFinite(scale)) throw new RangeError(`A scale must be more than 0, not ${scale}`)

    return {
        now: () => clock.now() / scale,
        after: (delay, fn) => clock.after(delay * scale, fn),
        every: (interval, fn) => clock.every(interval * scale, fn),
    }
}

interface FakeTimer {
    at: number
    order: number
    interval?: number
    fn: () => void
}

/**
 * A clock for tests: time stands still until `advance()` moves it, so nothing
 * depends on how fast the test's process runs.
 */
export class FakeClock implements Clock {
    #now = 0
    #order = 0
    readonly #timers = new Set<FakeTimer>()

    /** How many timers wait to run. An interval counts as one. */
    get pendingCount(): number {
        return this.#timers.size
    }

    now(): number {
        return this.#now
    }

    after(delay: number, fn: () => void): CancelTimer {
        return this.#add({ at: this.#now + atLeastZero(delay), order: this.#order++, fn })
    }

    every(interval: number, fn: () => void): CancelTimer {
        if (!(interval > 0)) throw new RangeError(`An interval must be more than 0, not ${interval}`)

        return this.#add({ at: this.#now + interval, order: this.#order++, interval, fn })
    }

    /**
     * Moves the time on by `ms` milliseconds and runs the timers that come due,
     * in the order of their times, each at its own time. After each timer it
     * lets what the timer began come to rest (promises, and what they lead to),
     * so a timer set from there runs too when it falls within the same advance.
     */
    async advance(ms: number): Promise<void> {
        const end = this.#now + atLeastZero(ms)

        await settle()

        for (let timer = this.#next(end); timer; timer = this.#next(end)) await this.#run(timer)

        this.#now = end
    }

    /**
     * Moves the time on to the timer due first and runs it, however far off it
     * is. Resolves with whether there was one: `false` means that no timer waits.
     */
    async advanceToNext(): Promise<boolean> {
        await settle()

        const timer = this.#next(Number.POSITIVE_INFINITY)

        if (!timer) return false

        await this.#run(timer)

        return true
    }

    async #run(timer: FakeTimer): Promise<void> {
        this.#now = timer.at

        if (timer.interval === undefined) this.#timers.delete(timer)
        else timer.at += timer.interval

        timer.fn()
        await settle()
    }

    #add(timer: FakeTimer): CancelTimer {
        this.#timers.add(timer)

        return () => {
            this.#timers.delete(timer)
        }
    }

    // The timer due first, up to and including `end`: of two at the same time, the one set first
    #next(end: number): FakeTimer | undefined {
        let next: FakeTimer | undefined

        for (const timer of this.#timers) {
            if (timer.at > end) continue
            if (!next || timer.at < next.at || (timer.at === next.at && timer.order < next.order)) next = timer
        }

        return next
    }
}

function atLeastZero(ms: number): number {
    return ms > 0 ? ms : 0
}

// A turn of the real event loop: every promise already resolved has run its handlers by then
function settle(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}
