import { afterEach, describe, expect, test } from 'bun:test'
import { createAddServerCommand, createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { CommandType } from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { defineRecordStore, MemoryRecordSource } from 'live-system/core'
import type { CommandResponse, LiveSystem } from 'live-system/core'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'
import { ServerManager } from './server-manager.ts'
import { bootSystem, collect, finishedEvents, until } from './test-support.ts'

const server = (id: string, overrides: Partial<ServerRecord> = {}): ServerRecord => ({
    id,
    name: `Server ${id.slice(1)}`,
    capacity: 10,
    load: 0,
    activeCommands: 0,
    ...overrides,
})

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: ServerRecord[] = []) => {
    const source = new MemoryRecordSource<ServerRecord>(records)
    const booted = await bootSystem<[ServerManager]>([
        context => new ServerManager(context, source, defineRecordStore<ServerRecord>('servers')(createPinia())),
    ])

    systems.push(booted.system)

    const { events } = booted.context
    const started = collect(events, 'commandStarted')
    const refused = collect(events, 'commandRefused')
    const queued = collect(events, 'commandQueued')
    let count = 0

    /** A user's request for a command, as a VirtualUser emits it. Returns the server that took it, if one did. */
    const request = (type: CommandType, userId = 'u1') => {
        const commandId = `c${++count}`

        events.emit('commandRequested', { commandId, userId, type })

        return started.find(event => event.commandId === commandId)?.serverId
    }

    return { ...booted, source, manager: booted.managers[0], request, started, refused, queued }
}

const result = <R>(response: CommandResponse<R>): R => {
    if (response.status !== 'accepted') throw new Error(`The command failed: ${response.error.message}`)

    return response.result as R
}

afterEach(async () => {
    for (const system of systems) await system.shutdown()
    systems = []
})

describe('the servers', () => {
    test('each server record has a live object', async () => {
        const { manager } = await boot([server('s1'), server('s2')])

        expect([...manager.objects.keys()]).toEqual(['s1', 's2'])
    })

    test('with no server at start, one is created', async () => {
        const { manager, source } = await boot()

        expect(await source.find()).toEqual([
            { id: expect.any(String), name: 'Server 1', capacity: 10, load: 0, activeCommands: 0 },
        ])
        expect(manager.objects.size).toBe(1)
    })

    test('with a server at start, none is created', async () => {
        const { source } = await boot([server('s1')])

        expect(await source.find()).toHaveLength(1)
    })

    test('servers/add creates a server, numbered after the highest', async () => {
        const { manager, source, send } = await boot([server('s1'), server('s7')])

        const { id } = result(await send<AddServerResult>(createAddServerCommand()))

        expect(await source.get(id)).toEqual({ id, name: 'Server 8', capacity: 10, load: 0, activeCommands: 0 })
        expect(manager.getObject(id)).toBeDefined()
    })

    test('servers/:id/remove removes the record and destroys its object', async () => {
        const { manager, source, send } = await boot([server('s1'), server('s2')])
        const object = manager.getObject('s1')

        expect(await send(createRemoveServerCommand('s1'))).toEqual({ status: 'accepted' })

        expect((await source.find()).map(record => record.id)).toEqual(['s2'])
        expect(manager.getObject('s1')).toBeUndefined()
        expect(object?.isDestroyed).toBe(true)
    })

    test('removing a server that does not exist is not_found', async () => {
        const { send } = await boot([server('s1')])

        expect(await send(createRemoveServerCommand('nope'))).toMatchObject({ status: 'failed', error: { code: 'not_found' } })
    })

    test('removing a server aborts the commands it runs', async () => {
        const { context, send, request } = await boot([server('s1')])
        const events = finishedEvents(context)

        request('agentic')
        await send(createRemoveServerCommand('s1'))

        expect(events).toEqual([{ commandId: 'c1', userId: 'u1', serverId: 's1', type: 'agentic', outcome: 'aborted' }])
    })
})

describe('a commandRequested event', () => {
    test('the command is run by a server, which announces it', async () => {
        const { manager, request, started, refused, queued } = await boot([server('s1')])

        expect(request('standard', 'u7')).toBe('s1')

        expect(started).toEqual([{ commandId: 'c1', userId: 'u7', serverId: 's1', type: 'standard' }])
        expect(refused).toEqual([])
        expect(queued).toEqual([])
        expect(manager.getObject('s1')?.load).toBe(2)
    })

    test('it goes to the server with the most free capacity', async () => {
        const { manager, request } = await boot([server('s1'), server('s2')])

        expect([request('agentic'), request('search'), request('standard')]).toEqual(['s1', 's2', 's2'])
        expect(manager.getObject('s1')?.load).toBe(4)
        expect(manager.getObject('s2')?.load).toBe(3)
    })

    test('a server without room for the cost is passed over', async () => {
        const { request } = await boot([server('s1', { capacity: 3 }), server('s2', { capacity: 4 })])

        expect(request('search')).toBe('s2')
        // Both now have 3 free: the first of them takes it
        expect(request('standard')).toBe('s1')
    })

    test('there is no route for a command: it is outside the router', async () => {
        const { send } = await boot([server('s1')])

        expect(await send({ route: 'servers/run-command', data: { userId: 'u1', type: 'search' } })).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })
})

describe('the queue', () => {
    test('with no room anywhere the command waits, and no load is added', async () => {
        const { manager, request, queued, refused } = await boot([server('s1', { capacity: 4 })])

        request('agentic', 'u1')

        expect(request('search', 'u2')).toBeUndefined()
        expect(queued).toEqual([{ commandId: 'c2', userId: 'u2', type: 'search' }])
        expect(refused).toEqual([])
        expect(manager.queueLength).toBe(1)
        expect(manager.getObject('s1')?.load).toBe(4)
    })

    test('a waiting command starts when a running one finishes', async () => {
        const { manager, context, request, started } = await boot([server('s1', { capacity: 1 })])
        const finished = finishedEvents(context)

        request('search', 'u1')
        request('search', 'u2')

        await until(() => finished.length === 1)

        expect(started.map(event => event.commandId)).toEqual(['c1', 'c2'])
        expect(manager.queueLength).toBe(0)
    })

    test('commands start in the order they arrived', async () => {
        const { context, request, started } = await boot([server('s1', { capacity: 1 })])
        const finished = finishedEvents(context)

        for (const userId of ['u1', 'u2', 'u3', 'u4']) request('search', userId)

        await until(() => finished.length === 4)

        expect(started.map(event => event.userId)).toEqual(['u1', 'u2', 'u3', 'u4'])
    })

    test('a small command does not pass a large one that waits for room', async () => {
        const { manager, context, request, started } = await boot([server('s1', { capacity: 5 })])
        const finished = finishedEvents(context)

        request('agentic', 'u1')
        request('agentic', 'u2')

        // There is 1 unit free, enough for a search, but the agentic command is ahead of it
        expect(request('search', 'u3')).toBeUndefined()
        expect(manager.queueLength).toBe(2)

        await until(() => finished.length === 1)

        expect(started.map(event => event.userId)).toEqual(['u1', 'u2', 'u3'])
    })

    test('the load never exceeds the capacity, however many commands are requested', async () => {
        const { manager, request, started, queued } = await boot([server('s1'), server('s2')])

        for (let user = 0; user < 30; user++) request('standard', `u${user}`)

        expect(started).toHaveLength(10)
        expect(queued).toHaveLength(20)
        for (const object of manager.objects.values()) expect(object.load).toBe(10)
    })

    test('every command accepted is run in the end', async () => {
        const { manager, context, request, started } = await boot([server('s1', { capacity: 4 })])
        const finished = finishedEvents(context)

        for (let user = 0; user < 12; user++) request(user % 3 === 0 ? 'agentic' : 'search', `u${user}`)

        await until(() => finished.length === 12, 5000)

        expect(started).toHaveLength(12)
        expect(finished.every(event => event.outcome === 'completed')).toBe(true)
        expect(manager.queueLength).toBe(0)
        expect(manager.getObject('s1')?.load).toBe(0)
    })

    test('a server added is room for what waits', async () => {
        const { manager, request, send, started } = await boot([server('s1', { capacity: 4 })])

        request('agentic', 'u1')
        request('agentic', 'u2')
        expect(manager.queueLength).toBe(1)

        const { id } = result(await send<AddServerResult>(createAddServerCommand()))

        expect(started.map(event => [event.userId, event.serverId])).toEqual([
            ['u1', 's1'],
            ['u2', id],
        ])
        expect(manager.queueLength).toBe(0)
    })

    test('a removed server aborts what it ran, and what waits moves on to the others', async () => {
        const { manager, context, request, send, started } = await boot([server('s1', { capacity: 4 }), server('s2', { capacity: 4 })])
        const finished = finishedEvents(context)

        request('agentic', 'u1')
        request('agentic', 'u2')
        request('agentic', 'u3')
        await send(createRemoveServerCommand('s1'))

        expect(finished).toMatchObject([{ userId: 'u1', serverId: 's1', outcome: 'aborted' }])
        expect(started.map(event => event.serverId)).toEqual(['s1', 's2'])
        expect(manager.queueLength).toBe(1)
    })
})

describe('the limits of one user', () => {
    test('three commands run at once, a fourth waits, a fifth is refused', async () => {
        const { manager, request, started, queued, refused } = await boot([server('s1')])

        for (let count = 0; count < 5; count++) request('search')

        expect(started.map(event => event.commandId)).toEqual(['c1', 'c2', 'c3'])
        expect(queued.map(event => event.commandId)).toEqual(['c4'])
        expect(refused).toEqual([{ commandId: 'c5', userId: 'u1', type: 'search', reason: 'queue_full' }])
        // There was room for all five
        expect(manager.getObject('s1')?.load).toBe(3)
    })

    test('the waiting command starts when one of the user\'s own finishes', async () => {
        const { context, request, started } = await boot([server('s1')])
        const finished = finishedEvents(context)

        for (let count = 0; count < 4; count++) request('search')

        await until(() => finished.length >= 1)

        expect(started.map(event => event.commandId)).toEqual(['c1', 'c2', 'c3', 'c4'])
    })

    test('once its waiting command has started, the user may queue another', async () => {
        const { context, request, queued, refused } = await boot([server('s1')])
        const finished = finishedEvents(context)

        for (let count = 0; count < 4; count++) request('search')
        await until(() => finished.length >= 1)
        request('agentic')
        request('agentic')
        request('agentic')

        expect(refused).toEqual([])
        await until(() => finished.length === 7, 5000)
        expect(queued.length).toBeGreaterThanOrEqual(1)
    })

    test('a user that waits for itself does not hold up the others', async () => {
        const { request, started } = await boot([server('s1')])

        for (let count = 0; count < 4; count++) request('search', 'u1')

        expect(request('search', 'u2')).toBe('s1')
        expect(started.map(event => event.userId)).toEqual(['u1', 'u1', 'u1', 'u2'])
    })

    test('one user waiting does not keep another from waiting', async () => {
        const { manager, request, refused } = await boot([server('s1', { capacity: 1 })])

        request('search', 'u1')
        request('search', 'u2')
        request('search', 'u3')
        request('search', 'u3')

        expect(manager.queueLength).toBe(2)
        expect(refused.map(event => [event.commandId, event.reason])).toEqual([['c4', 'queue_full']])
    })

    test('an aborted command counts as finished for its user', async () => {
        const { request, send, started } = await boot([server('s1'), server('s2', { capacity: 1 })])

        for (let count = 0; count < 3; count++) request('standard', 'u1')
        request('search', 'u1')
        await send(createRemoveServerCommand('s1'))

        // All three were on s1. With them gone the fourth runs, on the server that is left
        expect(started.at(-1)).toMatchObject({ commandId: 'c4', serverId: 's2' })
    })

    test('a removed user\'s waiting command is dropped', async () => {
        const { manager, context, request, refused } = await boot([server('s1', { capacity: 1 })])

        request('search', 'u1')
        request('search', 'u2')
        request('search', 'u3')
        context.events.emit('userRemoved', { userId: 'u2' })

        expect(refused).toEqual([{ commandId: 'c2', userId: 'u2', type: 'search', reason: 'dropped' }])
        expect(manager.queueLength).toBe(1)
    })
})

describe('stopping', () => {
    test('shutdown aborts what runs, drops what waits, removes the routes and stops listening', async () => {
        const { system, manager, context, send, request, started, refused } = await boot([server('s1', { capacity: 4 })])
        const events = finishedEvents(context)

        request('agentic', 'u1')
        request('agentic', 'u2')
        await system.shutdown()

        expect(events.map(event => [event.userId, event.outcome])).toEqual([['u1', 'aborted']])
        expect(refused.map(event => [event.userId, event.reason])).toEqual([['u2', 'dropped']])
        expect(manager.queueLength).toBe(0)
        expect(await send(createAddServerCommand())).toMatchObject({ status: 'failed', error: { code: 'not_found' } })

        request('search', 'u3')

        expect(started).toHaveLength(1)
        expect(refused).toHaveLength(1)
        // commandFinished still has the test's own listener
        expect(context.events.listenerCount('commandRequested')).toBe(0)
        expect(context.events.listenerCount('userRemoved')).toBe(0)
        expect(context.events.listenerCount('commandFinished')).toBe(1)
    })
})
