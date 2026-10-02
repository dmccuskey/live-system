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
