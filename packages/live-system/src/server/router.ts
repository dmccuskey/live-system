// Router: the command dispatcher. It matches a command's route to a handler and reports the outcome.
import { CommandError } from '../core/command.ts'
import type { Command, CommandResponse } from '../core/command.ts'
import type { RouteHandler, RouteParams, RouteRegistry } from '../core/manager.ts'

interface Segment {
    /** The literal text, or the parameter's name. */
    value: string
    isParam: boolean
}

interface Route {
    pattern: string
    segments: Segment[]
    handler: RouteHandler
    /** The manager that declared the route, and the handler's `this`. */
    manager: object | undefined
}

/**
 * Dispatches commands by route. A pattern is made of literal and `:param`
 * segments (`server/:id/restart`) and matches a route with the same number of
 * segments. Where several match, a literal segment beats a `:param`.
 *
 * It is not tied to a transport or to a `LiveSystem`: anything that has a
 * command calls `handle()`.
 */
export class Router implements RouteRegistry {
    // By pattern with the parameter names taken out, so 'server/:id' and 'server/:name' are one route
    #routes = new Map<string, Route>()

    /**
     * Adds a route. With a manager, the handler is called with it as `this`.
     * Throws on a malformed pattern and on a route that already exists.
     */
    register(pattern: string, handler: RouteHandler, manager?: object): void {
        const segments = parse(pattern)
        const key = segments.map(segment => (segment.isParam ? ':' : segment.value)).join('/')

        const existing = this.#routes.get(key)
        if (existing) {
            throw new Error(`The route '${pattern}' is already registered, as '${existing.pattern}'`)
        }

        this.#routes.set(key, { pattern, segments, handler, manager })
    }

    /** Removes every route registered for the manager. */
    removeManager(manager: object): void {
        for (const [key, route] of this.#routes) {
            if (route.manager === manager) this.#routes.delete(key)
        }
    }

    /** The registered patterns, in the order they were added. */
    get patterns(): string[] {
        return [...this.#routes.values()].map(route => route.pattern)
    }

    /**
     * Runs the command's handler and resolves with the response. It never
     * rejects: an unknown route and a handler that throws are `failed` responses.
     */
    async handle(command: Command): Promise<CommandResponse> {
        try {
            if (typeof command?.route !== 'string') {
                throw new CommandError('bad_request', 'A command needs a route')
            }

            const match = this.#match(command.route)
            if (!match) {
                throw new CommandError('not_found', `No route matches '${command.route}'`)
            }

            const result = await match.route.handler.call(match.route.manager, match.params, command.data)
            return result === undefined ? { status: 'accepted' } : { status: 'accepted', result }
        } catch (error) {
            return { status: 'failed', error: CommandError.info(error) }
        }
    }

    #match(path: string): { route: Route; params: RouteParams } | undefined {
        const parts = path.split('/')
        let best: Route | undefined

        for (const route of this.#routes.values()) {
            if (matches(route, parts) && (!best || isMoreSpecific(route, best))) best = route
        }
        if (!best) return undefined

        const params: RouteParams = {}
        best.segments.forEach((segment, index) => {
            if (segment.isParam) params[segment.value] = parts[index] as string
        })
        return { route: best, params }
    }
}

function parse(pattern: string): Segment[] {
    const segments = pattern.split('/').map(part => {
        const isParam = part.startsWith(':')
        return { value: isParam ? part.slice(1) : part, isParam }
    })

    if (segments.some(segment => segment.value === '')) {
        throw new Error(`The route '${pattern}' has an empty segment`)
    }

    const names = segments.filter(segment => segment.isParam).map(segment => segment.value)
    if (new Set(names).size !== names.length) {
        throw new Error(`The route '${pattern}' uses a parameter name twice`)
    }

    return segments
}

function matches(route: Route, parts: string[]): boolean {
    if (route.segments.length !== parts.length) return false
    return route.segments.every((segment, index) =>
        segment.isParam ? parts[index] !== '' : segment.value === parts[index],
    )
}

// Both match the same route, so where they differ one has a literal and the other a parameter.
// The first such segment decides.
function isMoreSpecific(route: Route, other: Route): boolean {
    for (const [index, segment] of route.segments.entries()) {
        if (segment.isParam !== other.segments[index]?.isParam) return !segment.isParam
    }
    return false
}
