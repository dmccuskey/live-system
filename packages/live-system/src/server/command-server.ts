// CommandServer: the HTTP adapter around the router. It turns a POST into a command.
import { CommandError } from '../core/command.ts'
import type { Command, CommandResponse } from '../core/command.ts'

/** What the server hands its commands to: the router, or anything with the same `handle()`. */
export interface CommandHandler {
    handle(command: Command): Promise<CommandResponse>
}

/** Says whether the system behind the server is in working order. */
export type HealthCheck = () => boolean | Promise<boolean>

export interface CommandServerOptions {
    router: CommandHandler
    /** The path commands are posted to. `/command` unless given. */
    path?: string
    /** With it the server answers a GET to `healthPath` as well. No health address unless given. */
    health?: HealthCheck
    /** The path of the health address. `/health` unless given. */
    healthPath?: string
}

export interface ListenOptions {
    /** The port to listen on. 0 takes any free port. */
    port: number
    hostname?: string
}

const STATUS_BY_CODE: Record<string, number> = {
    bad_request: 400,
    not_found: 404,
    method_not_allowed: 405,
}

/**
 * Accepts commands over HTTP: a POST to one path, with the command
 * (`{ route, data }`) as its JSON body. The response body is always a
 * `CommandResponse`.
 *
 * Given a health check, it also answers a GET to the health address: 200 with
 * `{ status: 'ok' }` while the check holds, 503 with `{ status: 'unavailable' }`
 * when it does not.
 *
 * `handle()` works on the standard `Request` and `Response`, so it can be put
 * behind any HTTP server. `listen()` serves it with Bun's.
 */
export class CommandServer {
    readonly path: string
    readonly healthPath: string
    #router: CommandHandler
    #health: HealthCheck | undefined
    #server: ReturnType<typeof Bun.serve> | undefined

    constructor(options: CommandServerOptions) {
        this.#router = options.router
        this.path = options.path ?? '/command'
        this.#health = options.health
        this.healthPath = options.healthPath ?? '/health'
    }

    /** The port being listened on, once `listen()` has been called. */
    get port(): number | undefined {
        return this.#server?.port
    }

    get isListening(): boolean {
        return this.#server !== undefined
    }

    /** Answers one HTTP request. It never rejects. */
    async handle(request: Request): Promise<Response> {
        if (this.#health && request.method === 'GET' && new URL(request.url).pathname === this.healthPath) {
            return this.#healthResponse(this.#health)
        }

        let response: CommandResponse
        try {
            response = await this.#router.handle(await this.#command(request))
        } catch (error) {
            response = { status: 'failed', error: CommandError.info(error) }
        }

        if (response.status === 'accepted') return Response.json(response)

        const status = STATUS_BY_CODE[response.error.code] ?? 500
        const headers = status === 405 ? { Allow: 'POST' } : undefined
        return Response.json(response, { status, headers })
    }

    listen(options: ListenOptions): void {
        if (this.#server) throw new Error('The CommandServer is already listening')

        this.#server = Bun.serve({
            port: options.port,
            hostname: options.hostname,
            fetch: request => this.handle(request),
        })
    }

    /** Stops listening, once the requests in progress are answered. Does nothing when not listening. */
    async close(): Promise<void> {
        const server = this.#server
        this.#server = undefined
        await server?.stop()
    }

    async #healthResponse(health: HealthCheck): Promise<Response> {
        let isHealthy: boolean
        try {
            isHealthy = await health()
        } catch {
            isHealthy = false
        }

        // Asked again each time: an answer from a cache would say nothing of now
        const headers = { 'Cache-Control': 'no-store' }
        return isHealthy
            ? Response.json({ status: 'ok' }, { headers })
            : Response.json({ status: 'unavailable' }, { status: 503, headers })
    }

    async #command(request: Request): Promise<Command> {
        if (new URL(request.url).pathname !== this.path) {
            throw new CommandError('not_found', `Commands are posted to '${this.path}'`)
        }
        if (request.method !== 'POST') {
            throw new CommandError('method_not_allowed', 'A command is sent with POST')
        }

        let body: unknown
        try {
            body = await request.json()
        } catch {
            throw new CommandError('bad_request', 'The body of a command is JSON')
        }

        const route = (body as { route?: unknown } | null)?.route
        if (typeof route !== 'string' || route === '') {
            throw new CommandError('bad_request', 'A command needs a route')
        }

        return { route, data: (body as { data?: unknown }).data }
    }
}
