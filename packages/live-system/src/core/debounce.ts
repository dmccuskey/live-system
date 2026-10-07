// debouncePatch: collects an object's record updates and writes them as one.
import { systemClock } from './clock.ts'
import type { CancelTimer, Clock } from './clock.ts'

export interface DebouncePatchOptions {
    /** Where the delay's timer comes from. Real time by default. */
    clock?: Clock
    /** Called with what a delayed write failed with. Logs with `console.error` by default. */
    onError?: (error: unknown) => void
}

export interface DebouncedPatch<T> {
    /** Adds to the pending patch and restarts the delay. A later value for a field replaces the earlier one. */
    patch(data: Partial<T>): void
    /** Writes the pending patch now. Resolves when it is written, or at once when nothing is pending. */
    flush(): Promise<void>
    /** Drops the pending patch without writing it. */
    cancel(): void
    readonly isPending: boolean
}

/**
 * Opt-in, for an object whose record changes faster than is worth writing:
 * updates are merged, and written once after `delay` milliseconds without
 * another. The timer belongs to whoever created this: it calls `flush()` or
 * `cancel()` at the end of its own life.
 */
export function debouncePatch<T>(
    write: (data: Partial<T>) => unknown,
    delay: number,
    options: DebouncePatchOptions = {},
): DebouncedPatch<T> {
    const clock = options.clock ?? systemClock
    const onError = options.onError ?? (error => console.error('debouncePatch: a write failed', error))

    let pending: Partial<T> | undefined
    let cancelTimer: CancelTimer | undefined

    function take(): Partial<T> | undefined {
        const data = pending

        cancelTimer?.()
        cancelTimer = undefined
        pending = undefined

        return data
    }

    async function flush(): Promise<void> {
        const data = take()

        if (data) await write(data)
    }

    return {
        patch(data) {
            pending = { ...pending, ...data }

            cancelTimer?.()
            cancelTimer = clock.after(delay, () => {
                flush().catch(onError)
            })
        },
        flush,
        cancel() {
            take()
        },
        get isPending() {
            return pending !== undefined
        },
    }
}
