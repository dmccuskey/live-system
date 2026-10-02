// Commands: the request, its response, the structured error and the route-filling helper.

/** A request that the system do something. The route names the action, the data carries its arguments. */
export interface Command<T = unknown> {
    route: string
    data: T
}

/** A command's failure as it travels in a response: a plain object, the same in process and over a transport. */
export interface CommandErrorInfo {
    name: string
    message: string
    /** `not_found`, `bad_request`, `internal`, or a code of the application's own. */
    code: string
}

/** What the sender of a command gets back: that it was accepted, or that it failed and why. */
export type CommandResponse<R = unknown> =
    | { status: 'accepted'; result?: R }
    | { status: 'failed'; error: CommandErrorInfo }

/**
 * A command's failure, as an error to throw. A handler throws one to choose
 * the code its sender sees. Anything else it throws is reported as `internal`.
 */
export class CommandError extends Error implements CommandErrorInfo {
    readonly code: string

    constructor(code: string, message: string, name = 'CommandError') {
        super(message)
        this.name = name
        this.code = code
    }

    /** The error a response carries, from whatever was thrown. */
    static info(error: unknown): CommandErrorInfo {
        if (error instanceof CommandError) return error.toJSON()
        if (error instanceof Error) return { name: error.name, message: error.message, code: 'internal' }
        return { name: 'Error', message: String(error), code: 'internal' }
    }

    toJSON(): CommandErrorInfo {
        return { name: this.name, message: this.message, code: this.code }
    }
}

/**
 * Fills a route pattern's `:param` segments: `fillRoute('server/:id/restart', { id: '42' })`
 * is `server/42/restart`. Throws when a parameter is missing, empty or holds a `/`.
 */
export function fillRoute(pattern: string, params: Record<string, string | number> = {}): string {
    return pattern
        .split('/')
        .map(segment => {
            if (!segment.startsWith(':')) return segment

            const name = segment.slice(1)
            const value = params[name]
            if (value === undefined || String(value) === '') {
                throw new Error(`The route '${pattern}' needs the parameter '${name}'`)
            }
            if (String(value).includes('/')) {
                throw new Error(`The parameter '${name}' of the route '${pattern}' cannot hold a '/'`)
            }
            return String(value)
        })
        .join('/')
}
