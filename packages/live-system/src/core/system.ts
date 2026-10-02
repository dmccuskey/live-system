// LiveSystem: the one object that holds the parts of a running system.
import { LifecycleRunner } from './lifecycle.ts'
import type { LifecycleState } from './lifecycle.ts'
import type { BaseManager, RouteRegistry } from './manager.ts'

export interface LiveSystemOptions<C> {
    /** The one object every manager shares. Its contents are the application's choice. */
    context: C
    /** Connects the infrastructure the application depends on, before any manager is initialized. */
    connect?: () => void | Promise<void>
    /** Closes what `connect` opened, after the managers have stopped. */
    disconnect?: () => void | Promise<void>
    /** Where the managers' routes are registered: on a server, its router. Without one, routes are not registered. */
    router?: RouteRegistry
}

/**
 * A system of managers and its lifecycle. An application creates one, adds its
 * managers and boots it. It knows nothing about the application's domain.
 */
export class LiveSystem<C = unknown> {
    #options: LiveSystemOptions<C>
    #lifecycle: LifecycleRunner
    #managers: BaseManager<C>[] = []
    // The managers to stop, in the order their init() was begun
    #begun: BaseManager<C>[] = []
    #connected = false
    #boot: Promise<void> | undefined
    #shutdown: Promise<void> | undefined

    constructor(options: LiveSystemOptions<C>) {
        this.#options = options
        this.#lifecycle = new LifecycleRunner({
            connect: () => this.#connect(),
            initManagers: () => this.#initManagers(),
            startManagers: () => this.#each(manager => manager.start()),
            runManagers: () => this.#each(manager => manager.run()),
            stopManagers: () => this.#stopManagers(),
        })
    }

    get state(): LifecycleState {
        return this.#lifecycle.state
    }

    /**
     * Creates a manager with the shared context and adds it to the system.
     * Its routes are registered with the system's router, when it has one.
     * Managers are initialized, started and run in the order they are added,
     * and stopped in the reverse.
     */
    addManager<M extends BaseManager<C>>(factory: (context: C) => M): M {
        if (this.#boot || this.#shutdown) {
            throw new Error('A manager can only be added before boot()')
        }

        const manager = factory(this.#options.context)
        this.#registerRoutes(manager)
        this.#managers.push(manager)

        return manager
    }

    /**
     * Takes the system from `created` to `running`. If a step fails, what had
     * started is stopped and disconnected, and the error is passed on.
     */
    boot(): Promise<void> {
        if (this.#boot || this.#shutdown) {
            throw new Error('boot() can only be called once, and not after shutdown()')
        }

        this.#boot = this.#run()
        return this.#boot
    }

    /**
     * Stops the managers, then closes the infrastructure connections. During a
     * boot it waits for the boot to settle first. Calling it again does nothing.
     */
    shutdown(): Promise<void> {
        this.#shutdown ??= this.#stop()
        return this.#shutdown
    }

    async #run(): Promise<void> {
        try {
            await this.#lifecycle.run()
        } catch (error) {
            // The startup error is the one to report, whatever the cleanup does
            await this.#release().catch(() => {})
            throw error
        }
    }

    async #stop(): Promise<void> {
        // A failed boot has cleaned up after itself and reported its error
        await this.#boot?.catch(() => {})
        await this.#release()
    }

    async #release(): Promise<void> {
        try {
            await this.#lifecycle.stop()
        } finally {
            for (const manager of this.#managers) {
                this.#options.router?.removeManager(manager)
            }
            if (this.#connected) {
                this.#connected = false
                await this.#options.disconnect?.()
            }
        }
    }

    // A manager whose routes cannot all be registered is not added, and leaves none behind
    #registerRoutes(manager: BaseManager<C>): void {
        const router = this.#options.router
        if (!router) return

        try {
            for (const [pattern, handler] of Object.entries(manager.routes())) {
                router.register(pattern, handler, manager)
            }
        } catch (error) {
            router.removeManager(manager)
            throw error
        }
    }

    async #connect(): Promise<void> {
        // Set first: a connect that fails part-way still has something to close
        this.#connected = true
        await this.#options.connect?.()
    }

    async #initManagers(): Promise<void> {
        for (const manager of this.#managers) {
            this.#begun.push(manager)
            await manager.init()
        }
    }

    async #each(hook: (manager: BaseManager<C>) => Promise<void>): Promise<void> {
        for (const manager of this.#managers) {
            await hook(manager)
        }
    }

    // Stops every manager whose init() was begun, last first. One that fails does not keep the others from stopping.
    async #stopManagers(): Promise<void> {
        const errors: unknown[] = []

        for (let manager = this.#begun.pop(); manager; manager = this.#begun.pop()) {
            try {
                await manager.stop()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Several managers failed to stop')
    }
}
