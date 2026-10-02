// LiveObject: the base of an object that exists while the system runs.

export interface LiveObjectOptions {
    /** Called once, when the object has been destroyed, so its owner can let go of it. */
    onDestroyed?: () => void
}

/**
 * Something that exists continuously within the running system. Its owner
 * creates it and decides when it goes away; the object releases what it holds.
 */
export abstract class LiveObject {
    #destroyed = false
    #onDestroyed: (() => void) | undefined

    constructor(options: LiveObjectOptions = {}) {
        this.#onDestroyed = options.onDestroyed
    }

    get isDestroyed(): boolean {
        return this.#destroyed
    }

    /**
     * The object's own startup, in step with its manager's: each is called
     * and awaited when the manager reaches that phase. An object created while
     * the system is running gets all three, one after the other. An object
     * overrides the ones it has work for.
     */
    init(): void | Promise<void> {}
    start(): void | Promise<void> {}
    /** From here on the object acts on its own: it starts its timers here, not earlier. */
    run(): void | Promise<void> {}

    /** Ends the object's life: releases what it holds, then tells its owner. Calling it again does nothing. */
    destroy(): void {
        if (this.#destroyed) return

        this.#destroyed = true

        try {
            this.release()
        } finally {
            this.#onDestroyed?.()
        }
    }

    /** Releases what the object holds: its timers, its subscriptions, its pending work. */
    protected release(): void {}
}
