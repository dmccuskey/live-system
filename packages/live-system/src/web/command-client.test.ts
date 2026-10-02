import { afterEach, describe, expect, test } from 'bun:test'
import { CommandError } from 'live-system/core'
import { CommandServer, Router } from 'live-system/server'
import { CommandClient } from 'live-system/web'

// The error a send() rejects with
async function failure(sent: Promise<unknown>): Promise<CommandError> {
    try {
        await sent
    } catch (error) {
        expect(error).toBeInstanceOf(CommandError)
        return error as CommandError
    }
    throw new Error('send() did not reject')
}

// A client whose fetch answers with what the test gives, and records what it was asked
function stubbed(answer: () => Response | Promise<Response>) {
    const requests: { url: string; init: RequestInit }[] = []
    const client = new CommandClient({
        url: 'http://server.test/command',
        fetch: async (url, init) => {
            requests.push({ url, init })
            return answer()
        },
    })

    return { client, requests }
}

describe('CommandClient with a CommandServer', () => {
    let server: CommandServer

    function client(path = '/command'): CommandClient {
        const router = new Router()
        router.register('server/:id/restart', (params, data) => ({ id: params.id, force: data.force }))
        router.register('server/:id/stop', () => {
            throw new CommandError('busy', 'The server is busy', 'BusyError')
        })
        router.register('server/:id/break', () => {
            throw new TypeError('Something broke')
        })
        router.register('ping', () => {})

        server = new CommandServer({ router })
        server.listen({ port: 0, hostname: '127.0.0.1' })

        return new CommandClient({ url: `http://127.0.0.1:${server.port}${path}` })
    }

    afterEach(() => server.close())

    test('resolves with the accepted response and its result', async () => {
        const response = await client().send<{ id: string; force: boolean }>({
            route: 'server/42/restart',
            data: { force: true },
        })

        expect(response).toEqual({ status: 'accepted', result: { id: '42', force: true } })
    })

    test('resolves with a response without a result', async () => {
        expect(await client().send({ route: 'ping', data: undefined })).toEqual({ status: 'accepted' })
    })

    test("rejects with the handler's CommandError", async () => {
        const error = await failure(client().send({ route: 'server/42/stop', data: null }))

        expect(error.toJSON()).toEqual({ name: 'BusyError', message: 'The server is busy', code: 'busy' })
    })

    test('rejects with not_found for an unknown route', async () => {
        const error = await failure(client().send({ route: 'no/such/route', data: null }))

        expect(error.code).toBe('not_found')
    })

    test('rejects with internal for any other error in a handler', async () => {
        const error = await failure(client().send({ route: 'server/42/break', data: null }))

        expect(error.toJSON()).toEqual({ name: 'TypeError', message: 'Something broke', code: 'internal' })
    })

    test('rejects with not_found when it posts to the wrong path', async () => {
        const error = await failure(client('/elsewhere').send({ route: 'ping', data: null }))

        expect(error.code).toBe('not_found')
    })

    test('rejects with unreachable when nothing is listening', async () => {
        const commands = client()
        await server.close()

        const error = await failure(commands.send({ route: 'ping', data: null }))

        expect(error.code).toBe('unreachable')
        expect(error.message).toContain(commands.url)
        expect(error.cause).toBeDefined()
    })
})

describe('CommandClient.send', () => {
    test('posts the command as JSON to its URL', async () => {
        const { client, requests } = stubbed(() => Response.json({ status: 'accepted' }))

        await client.send({ route: 'server/42/restart', data: { force: false } })

        expect(requests).toHaveLength(1)
        expect(requests[0]!.url).toBe('http://server.test/command')
        expect(requests[0]!.init.method).toBe('POST')
        expect(new Headers(requests[0]!.init.headers).get('Content-Type')).toBe('application/json')
        expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
            route: 'server/42/restart',
            data: { force: false },
        })
    })

    test('sends only the route and the data', async () => {
        const { client, requests } = stubbed(() => Response.json({ status: 'accepted' }))
        const command = { route: 'ping', data: 1, extra: 'not sent' }

        await client.send(command)

        expect(JSON.parse(requests[0]!.init.body as string)).toEqual({ route: 'ping', data: 1 })
    })

    test('keeps the cause when the request gets no answer', async () => {
        const cause = new TypeError('fetch failed')
        const { client } = stubbed(() => Promise.reject(cause))

        const error = await failure(client.send({ route: 'ping', data: null }))

        expect(error.code).toBe('unreachable')
        expect(error.cause).toBe(cause)
    })

    test('reads a failed response whatever the HTTP status', async () => {
        const info = { name: 'CommandError', message: 'No', code: 'refused' }
        const { client } = stubbed(() => Response.json({ status: 'failed', error: info }, { status: 200 }))

        const error = await failure(client.send({ route: 'ping', data: null }))

        expect(error.toJSON()).toEqual(info)
    })

    test('rejects with bad_response when the answer is not JSON', async () => {
        const { client } = stubbed(() => new Response('<html>Bad Gateway</html>', { status: 502 }))

        const error = await failure(client.send({ route: 'ping', data: null }))

        expect(error.code).toBe('bad_response')
        expect(error.message).toContain('502')
    })

    test.each([
        ['null', null],
        ['another shape', { ok: true }],
        ['an unknown status', { status: 'pending' }],
        ['a failure without an error', { status: 'failed' }],
        ['a failure with a partial error', { status: 'failed', error: { message: 'No' } }],
    ])('rejects with bad_response when the answer is %s', async (_name, body) => {
        const { client } = stubbed(() => Response.json(body))

        const error = await failure(client.send({ route: 'ping', data: null }))

        expect(error.code).toBe('bad_response')
    })

    test('does not retry', async () => {
        const { client, requests } = stubbed(() => Promise.reject(new Error('down')))

        await failure(client.send({ route: 'ping', data: null }))

        expect(requests).toHaveLength(1)
    })
})
