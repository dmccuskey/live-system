// CommandClient: sends commands to the live server over HTTP. It owns the transport and its errors.
import { CommandError } from '../core/command.ts'
import type { Command, CommandErrorInfo, CommandResponse } from '../core/command.ts'

export interface CommandClientOptions {
    /** Where commands are posted: the URL of the server's `CommandServer`, such as `http://localhost:3030/command`. */
    url: string
    /** The `fetch` to send with. The global one unless given. */
    fetch?: Fetch
}

/** As much of `fetch` as the client uses. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The response to a command the server accepted. */
export type AcceptedResponse<R = unknown> = Extract<CommandResponse<R>, { status: 'accepted' }>

/**
 * Sends commands to the live server: a POST of the command (`{ route, data }`)
 * as JSON, answered with a `CommandResponse`. It builds no commands: those
 * come from the application's command creators.
 *
 * Every failure is a `CommandError`, so a sender catches one type. The
 * server's own errors keep their codes; the transport adds `unreachable` (the
 * request got no answer) and `bad_response` (the answer was not a
 * `CommandResponse`). Nothing is retried.
 */
export class CommandClient {
    readonly url: string
    #fetch: Fetch

    constructor(options: CommandClientOptions) {
        this.url = options.url
        this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
    }

    /** Resolves with the response when the server accepted the command, rejects with a `CommandError` otherwise. */
    async send<R = unknown>(command: Command): Promise<AcceptedResponse<R>> {
        let answer: Response
        try {
            answer = await this.#fetch(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route: command.route, data: command.data })
            })
        } catch (cause) {
            const error = new CommandError('unreachable', `The command server at '${this.url}' cannot be reached`)
            error.cause = cause
            throw error
        }

        let response: unknown
        try {
            response = await answer.json()
        } catch {
            response = undefined
        }

        if (isAccepted(response)) return response as AcceptedResponse<R>
        if (isFailed(response)) {
            const { code, message, name } = response.error
            throw new CommandError(code, message, name)
        }

        throw new CommandError(
            'bad_response',
            `The answer from '${this.url}' (HTTP ${answer.status}) is not a command response`
        )
    }
}

function isAccepted(response: unknown): response is { status: 'accepted' } {
    return (response as { status?: unknown } | null)?.status === 'accepted'
}

function isFailed(response: unknown): response is { status: 'failed'; error: CommandErrorInfo } {
    const { status, error } = (response ?? {}) as { status?: unknown; error?: Partial<CommandErrorInfo> | null }

    return (
        status === 'failed' &&
        typeof error?.name === 'string' &&
        typeof error.message === 'string' &&
        typeof error.code === 'string'
    )
}
