import { describe, expect, test } from 'bun:test'
import { BaseManager, CommandError, LiveSystem } from 'live-system/core'
import type { RouteParams } from 'live-system/core'
import { Router } from 'live-system/server'

describe('Router, matching', () => {
    test('matches a literal route', async () => {
        const router = new Router()
        router.register('server/list', () => 'listed')

        expect(await router.handle({ route: 'server/list', data: undefined })).toEqual({
            status: 'accepted',
            result: 'listed',
        })
    })

    test('passes the parameters and the data to the handler', async () => {
        const router = new Router()
        const calls: unknown[] = []
        router.register('user/:user/server/:server/restart', (params, data) => {
            calls.push([params, data])
        })

        await router.handle({ route: 'user/ann/server/42/restart', data: { force: true } })

        expect(calls).toEqual([[{ user: 'ann', server: '42' }, { force: true }]])
    })

    test('matches by segment count', async () => {
        const router = new Router()
        router.register('server/:id', () => 'one')

        expect((await router.handle({ route: 'server/42/restart', data: undefined })).status).toBe('failed')
        expect((await router.handle({ route: 'server', data: undefined })).status).toBe('failed')
        expect((await router.handle({ route: 'server/', data: undefined })).status).toBe('failed')
    })

    test('a literal segment beats a parameter, whatever the order of registration', async () => {
        const first = new Router()
        first.register('server/:id', () => 'param')
        first.register('server/list', () => 'literal')

        const second = new Router()
        second.register('server/list', () => 'literal')
        second.register('server/:id', () => 'param')

        for (const router of [first, second]) {
            expect(await router.handle({ route: 'server/list', data: undefined })).toEqual({
                status: 'accepted',
                result: 'literal',
            })
            expect(await router.handle({ route: 'server/42', data: undefined })).toEqual({
                status: 'accepted',
                result: 'param',
            })
        }
    })

    test('the first segment that differs decides', async () => {
        const router = new Router()
        router.register(':kind/42/restart', () => 'late literals')
        router.register('server/:id/:action', () => 'early literal')

        expect(await router.handle({ route: 'server/42/restart', data: undefined })).toEqual({
            status: 'accepted',
            result: 'early literal',
        })
    })
})

describe('Router, registration', () => {
    test('a duplicate route is an error', () => {
        const router = new Router()
        router.register('server/:id/restart', () => {})

        expect(() => router.register('server/:id/restart', () => {})).toThrow('already registered')
    })

    test('patterns that differ only in parameter names are duplicates', () => {
        const router = new Router()
        router.register('server/:id', () => {})

        expect(() => router.register('server/:name', () => {})).toThrow("already registered, as 'server/:id'")
    })

    test('a malformed pattern is an error', () => {
        const router = new Router()

        expect(() => router.register('', () => {})).toThrow('empty segment')
        expect(() => router.register('server//restart', () => {})).toThrow('empty segment')
        expect(() => router.register('/server', () => {})).toThrow('empty segment')
        expect(() => router.register('server/:', () => {})).toThrow('empty segment')
        expect(() => router.register(':id/copy/:id', () => {})).toThrow('parameter name twice')
    })

    test('lists its patterns', () => {
        const router = new Router()
        router.register('server/list', () => {})
        router.register('server/:id', () => {})

        expect(router.patterns).toEqual(['server/list', 'server/:id'])
    })
})

describe('Router, responses', () => {
    test('accepted without a result when the handler returns nothing', async () => {
        const router = new Router()
        router.register('ping', () => {})

        expect(await router.handle({ route: 'ping', data: undefined })).toEqual({ status: 'accepted' })
    })

    test('awaits an asynchronous handler', async () => {
        const router = new Router()
        router.register('job/create', async () => ({ id: 'job-1' }))

        expect(await router.handle({ route: 'job/create', data: undefined })).toEqual({
            status: 'accepted',
            result: { id: 'job-1' },
        })
    })

    test('an unknown route is a structured not-found error', async () => {
        const router = new Router()

        expect(await router.handle({ route: 'server/42/restart', data: undefined })).toEqual({
            status: 'failed',
            error: { name: 'CommandError', message: "No route matches 'server/42/restart'", code: 'not_found' },
        })
    })

    test('a command without a route is a bad request', async () => {
        const router = new Router()
        const response = await router.handle({ data: 1 } as never)

        expect(response).toMatchObject({ status: 'failed', error: { code: 'bad_request' } })
    })

    test('a CommandError from the handler keeps its code', async () => {
        const router = new Router()
        router.register('server/:id/restart', () => {
            throw new CommandError('busy', 'The server is busy', 'ServerBusy')
        })

        expect(await router.handle({ route: 'server/42/restart', data: undefined })).toEqual({
            status: 'failed',
            error: { name: 'ServerBusy', message: 'The server is busy', code: 'busy' },
        })
    })

    test('any other failure is internal, thrown or rejected', async () => {
        const router = new Router()
        router.register('throws', () => {
            throw new TypeError('not a server')
        })
        router.register('rejects', async () => {
            throw new Error('too late')
        })

        expect(await router.handle({ route: 'throws', data: undefined })).toEqual({
            status: 'failed',
            error: { name: 'TypeError', message: 'not a server', code: 'internal' },
        })
        expect(await router.handle({ route: 'rejects', data: undefined })).toEqual({
            status: 'failed',
            error: { name: 'Error', message: 'too late', code: 'internal' },
        })
    })
})

// A manager with two commands, which only work when the handler is bound to it.
class Servers extends BaseManager {
    readonly restarted: string[] = []

    constructor(
        context: unknown,
        private readonly name = 'servers',
        private readonly extra: string[] = [],
    ) {
        super(context)
    }

    override routes() {
        return {
            [`${this.name}/:id/restart`]: this.restart,
            [`${this.name}/count`]: this.count,
            ...Object.fromEntries(this.extra.map(pattern => [pattern, this.count])),
        }
    }

    restart(params: RouteParams, data: { force: boolean }) {
        this.restarted.push(`${params.id}${data.force ? '!' : ''}`)
        return { id: params.id }
    }

    count() {
        return this.restarted.length
    }
}

describe('Router, with managers', () => {
    test("removeManager removes that manager's routes only", async () => {
        const router = new Router()
        const one = {}
        const two = {}
        router.register('one/a', () => {}, one)
        router.register('one/b', () => {}, one)
        router.register('two/a', () => {}, two)
        router.register('free', () => {})

        router.removeManager(one)

        expect(router.patterns).toEqual(['two/a', 'free'])
    })

    test('addManager registers the routes, bound to their manager', async () => {
        const router = new Router()
        const system = new LiveSystem<unknown>({ context: {}, router })
        const servers = system.addManager(context => new Servers(context))

        const response = await router.handle({ route: 'servers/42/restart', data: { force: true } })

        expect(response).toEqual({ status: 'accepted', result: { id: '42' } })
        expect(servers.restarted).toEqual(['42!'])
        expect(await router.handle({ route: 'servers/count', data: undefined })).toEqual({
            status: 'accepted',
            result: 1,
        })
    })

    test('two managers keep their own routes apart', async () => {
        const router = new Router()
        const system = new LiveSystem<unknown>({ context: {}, router })
        const servers = system.addManager(context => new Servers(context, 'servers'))
        const spares = system.addManager(context => new Servers(context, 'spares'))

        await router.handle({ route: 'spares/7/restart', data: { force: false } })

        expect(servers.restarted).toEqual([])
        expect(spares.restarted).toEqual(['7'])
    })

    test('a manager with a duplicate route is not added and leaves no routes', async () => {
        const router = new Router()
        const calls: string[] = []
        const system = new LiveSystem<unknown>({ context: {}, router })
        system.addManager(context => new Servers(context, 'servers'))

        expect(() => system.addManager(context => new Servers(context, 'spares', ['servers/count']))).toThrow(
            'already registered',
        )
        expect(router.patterns).toEqual(['servers/:id/restart', 'servers/count'])

        // The rejected manager takes no part in the lifecycle
        class Probe extends Servers {
            override async init() {
                calls.push('init')
            }
        }
        expect(() => system.addManager(context => new Probe(context, 'probe', ['servers/count']))).toThrow()
        await system.boot()
        await system.shutdown()
        expect(calls).toEqual([])
    })

    test("shutdown removes the managers' routes", async () => {
        const router = new Router()
        router.register('free', () => 'still here')
        const system = new LiveSystem<unknown>({ context: {}, router })
        system.addManager(context => new Servers(context))

        await system.boot()
        expect(router.patterns).toHaveLength(3)
        await system.shutdown()

        expect(router.patterns).toEqual(['free'])
        expect(await router.handle({ route: 'servers/count', data: undefined })).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })

    test('a boot that fails removes the routes too', async () => {
        const router = new Router()
        class Broken extends Servers {
            override async start() {
                throw new Error('broken')
            }
        }
        const system = new LiveSystem<unknown>({ context: {}, router })
        system.addManager(context => new Broken(context))

        await expect(system.boot()).rejects.toThrow('broken')

        expect(router.patterns).toEqual([])
    })

    test('a system without a router ignores routes', async () => {
        const system = new LiveSystem<unknown>({ context: {} })
        system.addManager(context => new Servers(context))

        await system.boot()
        await system.shutdown()
    })
})
