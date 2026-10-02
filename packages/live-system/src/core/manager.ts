// BaseManager: the lifecycle hooks, the shared context and the routes a manager declares.

/** The values of a route's `:param` segments, by name. */
export type RouteParams = Record<string, string>

/**
 * A command handler, as a manager declares it. What it returns, awaited, is the
 * command's result. `data` is `any` so that a handler can declare the payload it
 * expects, until payloads are typed by route.
 */
export type RouteHandler = (params: RouteParams, data: any) => unknown

/** The commands a manager handles, by route pattern (`server/:id/restart`). */
export type Routes = Record<string, RouteHandler>

/**
 * Where a system registers its managers' routes. The router of `live-system/server`
 * is one. It is an interface here so that the core does not depend on the server code.
 */
export interface RouteRegistry {
    /** Adds a route. The handler is called with `manager` as `this`. Throws on a route that already exists. */
    register(pattern: string, handler: RouteHandler, manager: object): void
    /** Removes every route registered for the manager. */
    removeManager(manager: object): void
}

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
