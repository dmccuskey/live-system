// EventBus: domain events between parts of an application that should not know each other.

import type { Unsubscribe } from './unsubscribe.ts'

/** Receives an event's payload. A listener may be async: it is not awaited. */
export type EventListener<T> = (event: T) => void

/** What `emit` takes after the name: the payload, or nothing when the payload's type is `void`. */
export type EventPayload<T> = [T] extends [void] ? [] : [event: T]

export interface EventBusOptions<E> {
    /** Called with what a listener threw or rejected with, and the event's name. Logs with `console.error` by default. */
    onError?: (error: unknown, name: keyof E) => void
}

/**
 * An optional tool: an application creates one, puts it in its context and
 * defines its events. `E` is the application's event map, from an event's name
 * to its payload type.
 */
export class EventBus<E> {
    #listeners = new Map<keyof E, Set<EventListener<never>>>()
    #onError: (error: unknown, name: keyof E) => void

    constructor(options: EventBusOptions<E> = {}) {
        this.#onError =
            options.onError ??
            ((error, name) => console.error(`EventBus: a listener for '${String(name)}' failed`, error))
    }

    /** Subscribes to an event. The function returned ends the subscription; calling it again does nothing. */
    on<K extends keyof E>(name: K, listener: EventListener<E[K]>): Unsubscribe {
        // A wrapper of its own, so the same function subscribed twice is two subscriptions
        const entry: EventListener<E[K]> = event => listener(event)

        let listeners = this.#listeners.get(name)

        if (!listeners) {
            listeners = new Set()
            this.#listeners.set(name, listeners)
        }

        listeners.add(entry)

        return () => {
            const current = this.#listeners.get(name)

            if (!current?.delete(entry)) return
            if (current.size === 0) this.#listeners.delete(name)
        }
    }

    /** Subscribes to the next occurrence of an event only. */
    once<K extends keyof E>(name: K, listener: EventListener<E[K]>): Unsubscribe {
        const unsubscribe = this.on(name, event => {
            unsubscribe()

            return listener(event)
        })

        return unsubscribe
    }

    /**
     * Delivers an event to its listeners, synchronously and in the order they
     * subscribed. A listener that fails stops neither the others nor the caller.
     */
    emit<K extends keyof E>(name: K, ...payload: EventPayload<E[K]>): void {
        const listeners = this.#listeners.get(name)

        if (!listeners) return

        const event = payload[0] as E[K]

        // A copy, so subscribing or unsubscribing during delivery does not change it
        for (const listener of [...listeners] as EventListener<E[K]>[]) {
            try {
                // An async listener returns a promise, whatever its type says
                const result: unknown = listener(event)

                if (result instanceof Promise) {
                    result.catch(error => this.#onError(error, name))
                }
            } catch (error) {
                this.#onError(error, name)
            }
        }
    }

    /** How many listeners an event has. */
    listenerCount(name: keyof E): number {
        return this.#listeners.get(name)?.size ?? 0
    }
}
