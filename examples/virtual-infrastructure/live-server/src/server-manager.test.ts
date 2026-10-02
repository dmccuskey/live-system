import { afterEach, describe, expect, test } from 'bun:test'
import { createAddServerCommand, createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import { MAX_SERVERS, type CommandType } from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import { defineRecordStore, MemoryRecordSource } from 'live-system/core'
import type { CommandResponse, LiveSystem } from 'live-system/core'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'
import type { ScalingDecider, ScalingDecision, ScalingSample } from './scaling-policy.ts'
import { ServerManager } from './server-manager.ts'
import { useSettingsStore } from './stores.ts'
import { bootSystem, collect, finishedEvents, TIME_SCALE, until } from './test-support.ts'

const server = (id: string, overrides: Partial<ServerRecord> = {}): ServerRecord => ({
    id,
    name: `Server ${id.slice(1)}`,
    capacity: 10,
    load: 0,
    activeCommands: 0,
    isDraining: false,
    ...overrides,
})

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: ServerRecord[] = [], policy?: ScalingDecider) => {
    const source = new MemoryRecordSource<ServerRecord>(records)
    const booted = await bootSystem<[ServerManager]>([
        context => {
            // As the SettingsManager has it there by the start. Manual, so the test decides on the servers.
            announce(context, { scalingMode: 'manual' })

            return new ServerManager(context, source, defineRecordStore<ServerRecord>('servers')(createPinia()), policy)
        },
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
            { id: expect.any(String), name: 'Server 1', capacity: 10, load: 0, activeCommands: 0, isDraining: false },
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

        expect(await source.get(id)).toEqual({ id, name: 'Server 8', capacity: 10, load: 0, activeCommands: 0, isDraining: false })
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

describe('the queue\'s length', () => {
    test('it is announced each time it changes', async () => {
        const { context, request } = await boot([server('s1', { capacity: 4 })])
        const lengths = collect(context.events, 'servers.queueChanged')

        request('agentic', 'u1')
        expect(lengths).toEqual([])

        request('agentic', 'u2')
        request('agentic', 'u3')
        expect(lengths).toEqual([{ length: 1, waitingForRoom: 1 }, { length: 2, waitingForRoom: 2 }])

        context.events.emit('userRemoved', { userId: 'u2' })
        expect(lengths).toEqual([{ length: 1, waitingForRoom: 1 }, { length: 2, waitingForRoom: 2 }, { length: 1, waitingForRoom: 1 }])
    })

    test('a command that waits for its own user is not one that waits for room', async () => {
        const { context, request } = await boot([server('s1'), server('s2')])
        const lengths = collect(context.events, 'servers.queueChanged')

        for (let count = 0; count < 4; count++) request('search', 'u1')
        expect(lengths).toEqual([{ length: 1, waitingForRoom: 0 }])

        await until(() => lengths.length === 2)

        expect(lengths.at(-1)).toEqual({ length: 0, waitingForRoom: 0 })
    })

    test('a refused command does not change it', async () => {
        const { context, request } = await boot([server('s1', { capacity: 4 })])
        const lengths = collect(context.events, 'servers.queueChanged')

        request('agentic', 'u1')
        request('agentic', 'u2')
        request('agentic', 'u2')

        expect(lengths).toEqual([{ length: 1, waitingForRoom: 1 }])
    })

    test('it is announced as empty once what waited has started', async () => {
        const { context, request } = await boot([server('s1', { capacity: 1 })])
        const lengths = collect(context.events, 'servers.queueChanged')

        request('search', 'u1')
        request('search', 'u2')
        await until(() => lengths.length === 2)

        expect(lengths).toEqual([{ length: 1, waitingForRoom: 1 }, { length: 0, waitingForRoom: 0 }])
    })

    test('the shutdown announces it as empty', async () => {
        const { system, context, request } = await boot([server('s1', { capacity: 4 })])
        const lengths = collect(context.events, 'servers.queueChanged')

        request('agentic', 'u1')
        request('agentic', 'u2')
        await system.shutdown()

        expect(lengths).toEqual([{ length: 1, waitingForRoom: 1 }, { length: 0, waitingForRoom: 0 }])
    })
})

// The settings record as it arrives in the store from the data service
const announce = (context: DemoContext, overrides: Partial<SettingsRecord> = {}) => {
    useSettingsStore(context.pinia).set({
        id: 'settings-1',
        key: 'servers',
        scalingMode: 'automatic',
        maxUtilization: 0.75,
        ...overrides,
    })
}

/** A policy that decides what the test tells it to, and keeps the samples it was given. */
const stubPolicy = () => {
    const samples: ScalingSample[] = []
    const decisions: ScalingDecision[] = []
    const counts = { resets: 0 }
    // The average the policy says it has
    const state = { utilization: 0 }
    const policy: ScalingDecider = {
        get utilization() {
            return state.utilization
        },
        sample: sample => {
            samples.push(sample)

            return decisions.shift()
        },
        reset: () => {
            counts.resets++
        },
    }

    /** Resolves once the policy has been asked again, so a decision pushed before has been acted on. */
    const sampled = async () => {
        const seen = samples.length

        await until(() => samples.length > seen && decisions.length === 0)
    }

    return { policy, samples, decisions, counts, state, sampled }
}

// Long enough for several samples
const aWhile = () => Bun.sleep(1_000 * TIME_SCALE * 5)

const ids = async (source: MemoryRecordSource<ServerRecord>) => (await source.find()).map(record => record.id)

describe('the utilization', () => {
    test("it is the policy's average, announced after a sample when it has changed", async () => {
        const stub = stubPolicy()
        const { context } = await boot([server('s1')], stub.policy)
        const announced = collect(context.events, 'servers.utilizationChanged')

        announce(context)
        stub.state.utilization = 0.4
        await stub.sampled()
        await stub.sampled()

        expect(announced).toEqual([{ utilization: 0.4 }])

        stub.state.utilization = 0.25
        await stub.sampled()

        expect(announced).toEqual([{ utilization: 0.4 }, { utilization: 0.25 }])
    })

    test('it is announced in whole percent', async () => {
        const stub = stubPolicy()
        const { context } = await boot([server('s1')], stub.policy)
        const announced = collect(context.events, 'servers.utilizationChanged')

        stub.state.utilization = 0.4567
        await stub.sampled()
        stub.state.utilization = 0.4612
        await stub.sampled()

        expect(announced).toEqual([{ utilization: 0.46 }])
    })

    test('it is announced in manual mode too', async () => {
        const stub = stubPolicy()
        const { manager, context } = await boot([server('s1')], stub.policy)
        const announced = collect(context.events, 'servers.utilizationChanged')

        stub.state.utilization = 0.6
        await stub.sampled()

        expect(manager.scalingMode).toBe('manual')
        expect(announced).toEqual([{ utilization: 0.6 }])
    })
})

describe('the scaling mode', () => {
    test('in manual mode the samples go on, and no decision is acted on', async () => {
        const stub = stubPolicy()
        const { manager, source } = await boot([server('s1'), server('s2')], stub.policy)

        stub.decisions.push('up', 'down')
        await stub.sampled()
        await aWhile()

        expect(manager.scalingMode).toBe('manual')
        expect(await ids(source)).toEqual(['s1', 's2'])
    })

    test('with no settings record the defaults are in force', async () => {
        const stub = stubPolicy()
        const source = new MemoryRecordSource<ServerRecord>([server('s1')])
        const booted = await bootSystem<[ServerManager]>([
            context => new ServerManager(context, source, defineRecordStore<ServerRecord>('servers')(createPinia()), stub.policy),
        ])

        systems.push(booted.system)
        await stub.sampled()

        expect(booted.managers[0].scalingMode).toBe('automatic')
        expect(stub.samples.at(-1)?.maxUtilization).toBe(0.75)
    })

    test('a settings record that goes missing leaves the defaults in force', async () => {
        const stub = stubPolicy()
        const { manager, context } = await boot([server('s1')], stub.policy)

        announce(context, { scalingMode: 'manual', maxUtilization: 0.5 })
        useSettingsStore(context.pinia).remove('settings-1')
        await stub.sampled()

        expect(manager.scalingMode).toBe('automatic')
        expect(stub.samples.at(-1)?.maxUtilization).toBe(0.75)
    })

    test('the settings record with its key in the store is its own', async () => {
        const { manager, context } = await boot([server('s1')])

        announce(context)

        expect(manager.scalingMode).toBe('automatic')
    })

    test('a settings record there before the start is in force from the start', async () => {
        const { manager } = await boot([server('s1')])

        expect(manager.scalingMode).toBe('manual')
    })

    test('a change of the record in the store is a change of the settings', async () => {
        const { manager, context } = await boot([server('s1')])

        announce(context)
        announce(context, { scalingMode: 'manual' })

        expect(manager.scalingMode).toBe('manual')
    })

    test('settings with another key are not', async () => {
        const { manager, context } = await boot([server('s1')])

        announce(context, { id: 'settings-2', key: 'users' })

        expect(manager.scalingMode).toBe('manual')
    })

    test('in automatic mode servers/add and servers/:id/remove are refused', async () => {
        const { context, source, send } = await boot([server('s1'), server('s2')], stubPolicy().policy)

        announce(context)

        expect(await send(createAddServerCommand())).toMatchObject({ status: 'failed', error: { code: 'automatic_mode' } })
        expect(await send(createRemoveServerCommand('s1'))).toMatchObject({
            status: 'failed',
            error: { code: 'automatic_mode' },
        })
        expect(await ids(source)).toEqual(['s1', 's2'])
    })

    test('back in manual mode they work again, and no decision is acted on', async () => {
        const stub = stubPolicy()
        const { context, source, send } = await boot([server('s1'), server('s2')], stub.policy)

        announce(context)
        announce(context, { scalingMode: 'manual' })

        expect(await send(createRemoveServerCommand('s2'))).toEqual({ status: 'accepted' })
        result(await send<AddServerResult>(createAddServerCommand()))
        stub.decisions.push('up')
        await stub.sampled()
        await aWhile()

        expect(await ids(source)).toHaveLength(2)
    })

    test('a change of mode begins the policy anew, a change of the maximum does not', async () => {
        const stub = stubPolicy()
        const { context } = await boot([server('s1')], stub.policy)

        const before = stub.counts.resets

        announce(context)
        expect(stub.counts.resets).toBe(before + 1)

        announce(context, { maxUtilization: 0.5 })
        expect(stub.counts.resets).toBe(before + 1)

        announce(context, { scalingMode: 'manual' })
        expect(stub.counts.resets).toBe(before + 2)
    })
})

describe('a sample', () => {
    test('it is the load and the capacity, with the maximum from the settings', async () => {
        const stub = stubPolicy()
        const { context, request } = await boot([server('s1'), server('s2')], stub.policy)

        request('agentic')
        announce(context, { maxUtilization: 0.6 })
        await stub.sampled()

        expect(stub.samples.at(-1)).toEqual({ load: 4, waiting: 0, capacity: 20, maxUtilization: 0.6 })
    })

    test('a command that waits for room is demand beyond the capacity', async () => {
        const stub = stubPolicy()
        const { context, request } = await boot([server('s1', { capacity: 4 })], stub.policy)

        request('agentic', 'u1')
        request('agentic', 'u2')
        announce(context)
        await stub.sampled()

        expect(stub.samples.at(-1)).toMatchObject({ load: 4, waiting: 4, capacity: 4 })
    })

    test('a command that waits for its own user is not', async () => {
        const stub = stubPolicy()
        const { manager, context, request } = await boot([server('s1')], stub.policy)

        for (let count = 0; count < 4; count++) request('standard', 'u1')
        announce(context)
        await stub.sampled()

        expect(manager.queueLength).toBe(1)
        expect(stub.samples.at(-1)).toMatchObject({ load: 6, waiting: 0, capacity: 10 })
    })

    test('with no server there is no capacity', async () => {
        const stub = stubPolicy()
        const { context, send } = await boot([server('s1')], stub.policy)

        await send(createRemoveServerCommand('s1'))
        announce(context)
        await stub.sampled()

        expect(stub.samples.at(-1)).toMatchObject({ load: 0, waiting: 0, capacity: 0 })
    })
})

describe('scaling up', () => {
    test('a server is added, numbered after the highest', async () => {
        const stub = stubPolicy()
        const { context, source } = await boot([server('s1')], stub.policy)

        announce(context)
        stub.decisions.push('up')
        await until(() => stub.decisions.length === 0)
        await stub.sampled()

        expect((await source.find()).map(record => record.name)).toEqual(['Server 1', 'Server 2'])
    })

    test('the new server is room for what waits', async () => {
        const stub = stubPolicy()
        const { context, request, started } = await boot([server('s1', { capacity: 4 })], stub.policy)

        request('agentic', 'u1')
        request('agentic', 'u2')
        announce(context)
        stub.decisions.push('up')

        await until(() => started.length === 2)

        expect(started[1]?.serverId).not.toBe('s1')
    })

    test('there are never more than the most servers', async () => {
        const stub = stubPolicy()
        const records = Array.from({ length: MAX_SERVERS }, (_, index) => server(`s${index + 1}`))
        const { context, source } = await boot(records, stub.policy)

        announce(context)
        stub.decisions.push('up')
        await stub.sampled()
        await aWhile()

        expect(await ids(source)).toHaveLength(MAX_SERVERS)
    })
})

describe('scaling down', () => {
    test('an idle server is removed, the newest first', async () => {
        const stub = stubPolicy()
        const { context, source } = await boot([server('s1'), server('s3'), server('s2')], stub.policy)

        announce(context)
        stub.decisions.push('down')
        await stub.sampled()

        expect(await ids(source)).toEqual(['s1', 's2'])
    })

    test('a busy server is left for an idle one', async () => {
        const stub = stubPolicy()
        const { context, source, request } = await boot([server('s1'), server('s2')], stub.policy)
        const events = finishedEvents(context)

        // The first server is the idle one: the second has less free
        expect(request('agentic')).toBe('s1')
        expect(request('search', 'u2')).toBe('s2')
        announce(context)
        await until(() => events.some(event => event.serverId === 's2'))
        stub.decisions.push('down')
        await stub.sampled()

        expect(await ids(source)).toEqual(['s1'])
        expect(events.map(event => event.outcome)).not.toContain('aborted')
    })

    test('the last server stays', async () => {
        const stub = stubPolicy()
        const { context, source } = await boot([server('s1')], stub.policy)

        announce(context)
        stub.decisions.push('down')
        await stub.sampled()
        await aWhile()

        expect(await ids(source)).toEqual(['s1'])
    })

    test('with none idle the least loaded is drained, and removed when its last command ends', async () => {
        const stub = stubPolicy()
        const { manager, context, source, request } = await boot([server('s1'), server('s2')], stub.policy)
        const events = finishedEvents(context)
        const patched: ServerRecord[] = []
        source.onPatched(record => patched.push(record))

        expect(request('agentic', 'u1')).toBe('s1')
        expect(request('standard', 'u2')).toBe('s2')
        announce(context)
        stub.decisions.push('down')
        await until(() => manager.getObject('s2')?.isDraining === true)

        // The draining server has the most free capacity, and is passed over
        expect(request('search', 'u3')).toBe('s1')
        expect(await ids(source)).toEqual(['s1', 's2'])

        await until(() => manager.getObject('s2') === undefined)

        expect(await ids(source)).toEqual(['s1'])
        expect(patched.some(record => record.id === 's2' && record.isDraining)).toBe(true)
        expect(events.map(event => [event.commandId, event.outcome])).toContainEqual(['c2', 'completed'])
        expect(events.map(event => event.outcome)).not.toContain('aborted')
    })

    test('of the least loaded, the newest is drained', async () => {
        const stub = stubPolicy()
        const { manager, context, request } = await boot([server('s1'), server('s2'), server('s3')], stub.policy)

        for (const userId of ['u1', 'u2', 'u3']) request('agentic', userId)
        announce(context)
        stub.decisions.push('down')
        await stub.sampled()

        expect([...manager.objects.values()].filter(object => object.isDraining).map(object => object.id)).toEqual(['s3'])
    })

    test('one server leaves at a time', async () => {
        const stub = stubPolicy()
        const { manager, context, request } = await boot([server('s1'), server('s2'), server('s3')], stub.policy)

        for (const userId of ['u1', 'u2', 'u3']) request('agentic', userId)
        announce(context)
        stub.decisions.push('down', 'down')
        await stub.sampled()

        expect([...manager.objects.values()].filter(object => object.isDraining)).toHaveLength(1)
    })

    test('a draining server is left out of the sample', async () => {
        const stub = stubPolicy()
        const { context, request } = await boot([server('s1'), server('s2')], stub.policy)

        request('agentic', 'u1')
        request('agentic', 'u2')
        announce(context)
        await stub.sampled()
        expect(stub.samples.at(-1)).toMatchObject({ load: 8, capacity: 20 })

        stub.decisions.push('down')
        await stub.sampled()
        await stub.sampled()

        expect(stub.samples.at(-1)).toMatchObject({ load: 4, waiting: 0, capacity: 10 })
    })

    test('scaling up takes a draining server back, and adds none', async () => {
        const stub = stubPolicy()
        const { manager, context, source, request } = await boot([server('s1'), server('s2')], stub.policy)
        const events = finishedEvents(context)

        request('agentic', 'u1')
        request('agentic', 'u2')
        announce(context)
        stub.decisions.push('down')
        await until(() => manager.getObject('s2')?.isDraining === true)

        stub.decisions.push('up')
        await until(() => manager.getObject('s2')?.isDraining === false)
        await until(() => events.length === 2)
        await aWhile()

        expect(await ids(source)).toEqual(['s1', 's2'])
        expect(request('search', 'u3')).toBeDefined()
    })

    test('a server taken back is room for what waits', async () => {
        const stub = stubPolicy()
        const { manager, context, request, started } = await boot(
            [server('s1', { capacity: 4 }), server('s2', { capacity: 8 })],
            stub.policy,
        )

        expect(request('agentic', 'u1')).toBe('s2')
        expect(request('agentic', 'u2')).toBe('s1')
        announce(context)
        stub.decisions.push('down')
        await until(() => [...manager.objects.values()].some(object => object.isDraining))

        const draining = [...manager.objects.values()].find(object => object.isDraining)?.id

        expect(draining).toBe('s2')
        expect(request('agentic', 'u3')).toBeUndefined()

        stub.decisions.push('up')
        await until(() => started.length === 3)

        expect(started[2]).toMatchObject({ userId: 'u3', serverId: 's2' })
    })

    test('a draining server finishes draining after a change to manual mode', async () => {
        const stub = stubPolicy()
        const { manager, context, source, request } = await boot([server('s1'), server('s2')], stub.policy)

        request('agentic', 'u1')
        request('standard', 'u2')
        announce(context)
        stub.decisions.push('down')
        await until(() => manager.getObject('s2')?.isDraining === true)
        announce(context, { scalingMode: 'manual' })

        await until(() => manager.getObject('s2') === undefined)

        expect(await ids(source)).toEqual(['s1'])
    })
})

describe('automatic scaling, with its own policy', () => {
    test('an average utilization above the band adds a server', async () => {
        const { manager, context, source, request } = await boot([server('s1')])

        announce(context, { maxUtilization: 0.7 })
        request('agentic', 'u1')
        request('agentic', 'u2')

        await until(() => manager.objects.size === 2)

        expect((await source.find()).map(record => record.name)).toEqual(['Server 1', 'Server 2'])
    })

    test('a short peak adds nothing', async () => {
        const { context, source, request } = await boot([server('s1')])

        announce(context)
        for (const userId of ['u1', 'u2', 'u3']) {
            for (let count = 0; count < 3; count++) request('search', userId)
        }
        await Bun.sleep(1_000 * TIME_SCALE * 12)

        expect(await ids(source)).toEqual(['s1'])
    })

    test('commands that wait for room add a server, though the maximum is not reached', async () => {
        const { manager, context, request, started } = await boot([server('s1')])

        announce(context, { maxUtilization: 0.95 })
        for (const userId of ['u1', 'u2', 'u3']) request('agentic', userId)

        expect(manager.queueLength).toBe(1)
        await until(() => started.length === 3)

        expect(started[2]?.serverId).not.toBe('s1')
    })

    test('idle servers are removed one by one, down to the last', async () => {
        const { context, source } = await boot([server('s1'), server('s2'), server('s3')])
        const removed: string[] = []
        source.onRemoved(record => removed.push(record.id))

        announce(context)
        await until(() => removed.length === 2, 5_000)
        await Bun.sleep(1_000 * TIME_SCALE * 25)

        expect(removed).toEqual(['s3', 's2'])
        expect(await ids(source)).toEqual(['s1'])
    })
})

describe('stopping', () => {
    test('after the shutdown nothing is sampled', async () => {
        const stub = stubPolicy()
        const { system, context } = await boot([server('s1')], stub.policy)

        announce(context)
        await stub.sampled()
        await system.shutdown()

        const sampled = stub.samples.length

        await aWhile()

        expect(stub.samples).toHaveLength(sampled)
    })

    test('after the shutdown the settings store is no longer watched', async () => {
        const { system, manager, context } = await boot([server('s1')])

        announce(context)
        await system.shutdown()
        announce(context, { scalingMode: 'manual' })

        expect(manager.scalingMode).toBe('automatic')
    })

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
