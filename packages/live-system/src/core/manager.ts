// BaseManager: the lifecycle hooks, the shared context and the routes a manager declares.

/** A command handler, as a manager declares it. A placeholder until the router fixes its shape. */
export type RouteHandler = (...args: never[]) => unknown

/** The commands a manager handles, by route pattern. */
export type Routes = Record<string, RouteHandler>

/**
 * The base of every manager. `C` is the application's context, the one object
 * every manager shares. A manager overrides the hooks it has work for.
 */
export abstract class BaseManager<C = unknown> {
    constructor(protected readonly context: C) {}

    /** The commands this manager handles. None, unless overridden. */
    routes(): Routes {
        return {}
    }

    /** Called once the system's infrastructure is ready. */
    async init(): Promise<void> {}
    async start(): Promise<void> {}
    async run(): Promise<void> {}
    /** Releases what the manager holds: its subscriptions, its timers, its live objects. */
    async stop(): Promise<void> {}
}
