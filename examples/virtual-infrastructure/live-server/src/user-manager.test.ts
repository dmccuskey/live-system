import { afterEach, describe, expect, test } from 'bun:test'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { AddUserResult } from '@virtual-infrastructure/protocol/users/users.commands'
import { FRUSTRATION_REFUSED, USER_NAMES } from '@virtual-infrastructure/protocol/users/users.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { defineRecordStore, MemoryRecordSource } from 'live-system/core'
import type { LiveSystem } from 'live-system/core'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'
import { advanceUntil, bootSystem, collect } from './test-support.ts'
import { UserManager } from './user-manager.ts'

const user = (id: string, name: string): UserRecord => ({
    id,
    name,
    commandsPerMinute: 20,
    commandMix: { search: 0.7, standard: 0.2, agentic: 0.1 },
    frustration: 0,
    served: 1,
})

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: UserRecord[] = []) => {
    const source = new MemoryRecordSource<UserRecord>(records)
    const booted = await bootSystem<[UserManager]>([
        context => new UserManager(context, source, defineRecordStore<UserRecord>('users')(createPinia())),
    ])

    systems.push(booted.system)

    return { ...booted, source, manager: booted.managers[0] }
}

afterEach(async () => {
    for (const system of systems) await system.shutdown()
    systems = []
})

describe('the users', () => {
    test('each user record has a live object', async () => {
        const { manager } = await boot([user('u1', 'Alice'), user('u2', 'Bob')])

        expect([...manager.objects.keys()]).toEqual(['u1', 'u2'])
    })

    test('with no user at start, one is created', async () => {
        const { manager, source } = await boot()
        const records = await source.find()

        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({ name: 'Alice', frustration: 0, served: 1 })
        expect(manager.objects.size).toBe(1)
    })

    test('with a user at start, none is created', async () => {
        const { source } = await boot([user('u1', 'Alice')])

        expect(await source.find()).toHaveLength(1)
    })

    test('users/add creates a user with a profile and the next free name', async () => {
        const { manager, source, send } = await boot([user('u1', 'Alice'), user('u3', 'Charlie')])

        const response = await send<AddUserResult>(createAddUserCommand())
        if (response.status !== 'accepted') throw new Error(response.error.message)
        const id = response.result?.id as string
        const record = await source.get(id)

        expect(record.name).toBe('Bob')
        expect(record.frustration).toBe(0)
        expect(record.commandsPerMinute).toBeGreaterThan(0)
        expect(record.commandMix.search + record.commandMix.standard + record.commandMix.agentic).toBeCloseTo(1)
        expect(manager.getObject(id)).toBeDefined()
    })

    test('when the names run out, users are numbered', async () => {
        const { source, send } = await boot(USER_NAMES.map((name, index) => user(`u${index}`, name)))

        await send(createAddUserCommand())
        await send(createAddUserCommand())

        const names = (await source.find()).map(record => record.name)

        expect(names.slice(USER_NAMES.length)).toEqual([
            `User ${USER_NAMES.length + 1}`,
            `User ${USER_NAMES.length + 2}`,
        ])
    })

    test('users/:id/remove removes the record and destroys its object', async () => {
        const { manager, source, send } = await boot([user('u1', 'Alice'), user('u2', 'Bob')])
        const object = manager.getObject('u1')

        expect(await send(createRemoveUserCommand('u1'))).toEqual({ status: 'accepted' })

        expect((await source.find()).map(record => record.id)).toEqual(['u2'])
        expect(manager.getObject('u1')).toBeUndefined()
        expect(object?.isDestroyed).toBe(true)
    })

    test('a removed user is announced with userRemoved', async () => {
        const { context, send } = await boot([user('u1', 'Alice'), user('u2', 'Bob')])
        const removed = collect(context.events, 'userRemoved')

        await send(createRemoveUserCommand('u2'))

        expect(removed).toEqual([{ userId: 'u2' }])
    })

    test('removing a user that does not exist is not_found', async () => {
        const { send } = await boot([user('u1', 'Alice')])

        expect(await send(createRemoveUserCommand('nope'))).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })
})

describe('the users at work', () => {
    // A system with the commands its users request, from the run phase on
    const bootAndCollect = async (records: UserRecord[]) => {
        const booted = await boot(records)

        return { ...booted, sent: collect(booted.context.events, 'commandRequested') }
    }

    test('a user added while the system runs begins to send commands', async () => {
        const { send, sent, clock } = await bootAndCollect([user('u1', 'Alice')])
        const response = await send<AddUserResult>(createAddUserCommand())
        if (response.status !== 'accepted') throw new Error(response.error.message)
        const id = response.result?.id

        await advanceUntil(clock, () => sent.some(event => event.userId === id))
    })

    test('a removed user stops sending', async () => {
        const { send, sent, clock } = await bootAndCollect([user('u1', 'Alice')])

        await advanceUntil(clock, () => sent.length >= 1)
        await send(createRemoveUserCommand('u1'))

        const count = sent.length
        await clock.advance(12_000)

        expect(sent).toHaveLength(count)
    })

    test('after shutdown no user sends', async () => {
        const { system, sent, clock } = await bootAndCollect([user('u1', 'Alice'), user('u2', 'Bob')])

        await advanceUntil(clock, () => sent.length >= 1)
        await system.shutdown()

        const count = sent.length
        await clock.advance(12_000)

        expect(sent).toHaveLength(count)
    })
})

describe('frustration', () => {
    test("what becomes of a user's commands reaches its record", async () => {
        const { context, source, clock } = await boot([{ ...user('u1', 'Alice'), commandsPerMinute: 0 }])

        context.events.emit('commandRefused', { commandId: 'c1', userId: 'u1', type: 'search', reason: 'queue_full' })
        await clock.advance(3_000)

        expect((await source.get('u1')).frustration).toBeCloseTo(FRUSTRATION_REFUSED)
    })

    test('the frustration of an earlier run is cleared at startup', async () => {
        const { source } = await boot([{ ...user('u1', 'Alice'), commandsPerMinute: 0, frustration: 0.7 }])

        expect((await source.get('u1')).frustration).toBe(0)
    })
})
