// WebStartup: boots a web app's system and keeps a reactive status for the UI to render from.
import { shallowReactive, shallowReadonly } from 'vue'
import type { LiveSystem } from '../core/system.ts'

/** What the startup needs of a system. */
export type Bootable = Pick<LiveSystem, 'boot' | 'shutdown'>

/**
 * Where a web app's system stands: `created` before `start()`, `starting`
 * while it connects and its managers load, then `running` or `failed`, and
 * `stopped` after `stop()`.
 */
export type SystemPhase = 'created' | 'starting' | 'running' | 'failed' | 'stopped'

/** Reactive: reading it in a template, a `computed` or a `watch` tracks it. */
export interface SystemStatus {
    readonly phase: SystemPhase
    /** What made the startup fail, while the phase is `failed`. */
    readonly error: unknown
}

/**
 * A web app's startup. The app is shown at once and renders from `status`: a
 * loading screen while `starting`, the app when `running`, the reason when
 * `failed`.
 *
 *     const startup = new WebStartup(system)
 *     app.provide('status', startup.status)
 *     app.mount('#app')
 *     startup.start()
 *
 * The status is the system's, not the connection's: a connection lost after
 * startup is reported by the connection, which the application shows itself.
 */
export class WebStartup {
    readonly status: SystemStatus
    #status = shallowReactive<{ phase: SystemPhase; error: unknown }>({ phase: 'created', error: undefined })
    #system: Bootable

    constructor(system: Bootable) {
        this.#system = system
        this.status = shallowReadonly(this.#status)
    }

    /**
     * Boots the system: connects, then has the managers load into the store.
     * A failed boot does not reject: it is reported in `status`, where the UI
     * reads it. Rejects only when called a second time.
     */
    async start(): Promise<void> {
        if (this.#status.phase !== 'created') {
            throw new Error('start() can only be called once')
        }

        this.#status.phase = 'starting'
        try {
            await this.#system.boot()
            this.#settle('running')
        } catch (error) {
            this.#settle('failed', error)
        }
    }

    /** Shuts the system down. Calling it again does nothing. */
    async stop(): Promise<void> {
        try {
            await this.#system.shutdown()
        } finally {
            this.#status.phase = 'stopped'
            this.#status.error = undefined
        }
    }

    // A startup that was stopped meanwhile stays stopped
    #settle(phase: SystemPhase, error?: unknown): void {
        if (this.#status.phase !== 'starting') return

        this.#status.error = error
        this.#status.phase = phase
    }
}
