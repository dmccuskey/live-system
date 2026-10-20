// readable(): a reactive value for a UI that isn't Vue, as `get()` and `subscribe()`.
import { computed, watch } from '@vue/reactivity'
import type { Unsubscribe } from '../core/unsubscribe.ts'

/**
 * A value a UI reads and follows. Svelte reads it as a store; React through
 * `useSyncExternalStore(value.subscribe, value.get)`; Angular sets a signal
 * from `subscribe()`.
 */
export interface Readable<T> {
    /** The value now. The same value until it changes. */
    get(): T
    /** Calls the listener at once with the value, then with each new one. */
    subscribe(listener: (value: T) => void): Unsubscribe
}

/**
 * Makes any reactive read a `Readable`: one record, a list, a value derived
 * from several stores, a `WebStartup`'s status.
 *
 *     const user = readable(() => users.get(id))
 *     const phase = readable(() => startup.status.phase)
 *
 * It follows only what the getter reads, so a record changing does not wake
 * the listeners of another. Changes made together, in one task, reach a
 * listener once, with the last value.
 */
export function readable<T>(getter: () => T): Readable<T> {
    const value = computed(getter)

    return {
        get: () => value.value,

        subscribe(listener) {
            let last = value.value
            let queued = false
            let stopped = false

            listener(last)

            const handle = watch(value, () => {
                if (queued) return

                queued = true
                queueMicrotask(() => {
                    queued = false
                    if (stopped || Object.is(value.value, last)) return

                    last = value.value
                    listener(last)
                })
            })

            return () => {
                stopped = true
                handle.stop()
            }
        },
    }
}
