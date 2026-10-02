import { afterEach, describe, expect, test } from 'bun:test'
import { CommandError } from 'live-system/core'
import type { Command } from 'live-system/core'
import { CommandServer, Router } from 'live-system/server'

function post(body: unknown, path = '/command'): Request {
    return new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    })
}

function serverWithRoutes(): CommandServer {
    const router = new Router()
    router.register('server/:id/restart', (params, data) => ({ id: params.id, force: data.force }))
    router.register('server/:id/stop', () => {
        throw new CommandError('busy', 'The server is busy')
    })
    router.register('ping', () => {})
    return new CommandServer({ router })
}

describe('CommandServer.handle', () => {
    test('turns a POST into a command and answers with its response', async () => {
        const response = await serverWithRoutes().handle(post({ route: 'server/42/restart', data: { force: true } }))

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toContain('application/json')
        expect(await response.json()).toEqual({ status: 'accepted', result: { id: '42', force: true } })
    })

    test('hands the command to whatever handles commands', async () => {
        const commands: Command[] = []
        const server = new CommandServer({
            router: {
                async handle(command) {
                    commands.push(command)
                    return { status: 'accepted' }
                }
            }
        })

        await server.handle(post({ route: 'a/b', data: [1, 2] }))
        await server.handle(post({ route: 'no/data' }))

        expect(commands).toEqual([
            { route: 'a/b', data: [1, 2] },
            { route: 'no/data', data: undefined }
        ])
    })

    test('a command without a result is accepted', async () => {
        const response = await serverWithRoutes().handle(post({ route: 'ping' }))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: 'accepted' })
    })

    test('an unknown route is 404', async () => {
        const response = await serverWithRoutes().handle(post({ route: 'server/42/explode' }))

        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'not_found' } })
    })

    test('a failed command is 500, with its error', async () => {
        const response = await serverWithRoutes().handle(post({ route: 'server/42/stop' }))

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({
            status: 'failed',
            error: { name: 'CommandError', message: 'The server is busy', code: 'busy' }
        })
    })

    test('a body that is not JSON is 400', async () => {
        const response = await serverWithRoutes().handle(post('{ not json'))

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'bad_request' } })
    })

    test('a body without a route is 400', async () => {
        for (const body of [{}, { data: 1 }, { route: 42 }, { route: '' }, null, 'text', [1]]) {
            const response = await serverWithRoutes().handle(post(body))

            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'bad_request' } })
        }
    })

    test('anything but POST is 405', async () => {
        const response = await serverWithRoutes().handle(new Request('http://localhost/command'))

        expect(response.status).toBe(405)
        expect(response.headers.get('Allow')).toBe('POST')
        expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'method_not_allowed' } })
    })

    test('another path is 404', async () => {
        const response = await serverWithRoutes().handle(post({ route: 'ping' }, '/elsewhere'))

        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'not_found' } })
    })

    test('the path can be chosen', async () => {
        const router = new Router()
        router.register('ping', () => 'pong')
        const server = new CommandServer({ router, path: '/api/commands' })

        expect((await server.handle(post({ route: 'ping' }, '/api/commands'))).status).toBe(200)
        expect((await server.handle(post({ route: 'ping' }))).status).toBe(404)
    })

    test('a handler that rejects is still answered', async () => {
        const server = new CommandServer({
            router: {
                async handle() {
                    throw new Error('the router is gone')
                }
            }
        })
        const response = await server.handle(post({ route: 'ping' }))

        expect(response.status).toBe(500)
        expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'internal' } })
    })
})

describe('CommandServer.listen', () => {
    let server: CommandServer | undefined

    afterEach(async () => {
        await server?.close()
        server = undefined
    })

    test('serves commands over HTTP', async () => {
        server = serverWithRoutes()
        expect(server.isListening).toBe(false)
        expect(server.port).toBeUndefined()

        server.listen({ port: 0, hostname: '127.0.0.1' })
        expect(server.isListening).toBe(true)

        const response = await fetch(`http://127.0.0.1:${server.port}/command`, {
            method: 'POST',
            body: JSON.stringify({ route: 'server/42/restart', data: { force: false } })
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: 'accepted', result: { id: '42', force: false } })
    })

    test('listening twice is an error', () => {
        server = serverWithRoutes()
        server.listen({ port: 0, hostname: '127.0.0.1' })

        expect(() => server?.listen({ port: 0 })).toThrow('already listening')
    })

    test('close stops listening, and can be called again', async () => {
        server = serverWithRoutes()
        server.listen({ port: 0, hostname: '127.0.0.1' })
        const port = server.port

        await server.close()
        await server.close()

        expect(server.isListening).toBe(false)
        expect(fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', body: '{}' })).rejects.toThrow()
    })
})
