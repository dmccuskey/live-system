// The manager records in the store, and the ServerManager's own among them.
import { createUpdateManagerCommand } from '@virtual-infrastructure/protocol/managers/managers.commands'
import { afterEach, describe, expect, test } from 'bun:test'
import { DEFAULT_MANAGER_RECORDS } from '@virtual-infrastructure/protocol/managers/managers.constants'
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { MemoryRecordSource } from 'live-system/core'
import type { LiveSystem } from 'live-system/core'
import type { DemoContext } from './context.ts'
import { ManagerRecords } from './manager-records.ts'
import { ServerManager } from './server-manager.ts'
import { useManagerStore, useServerStore } from './stores.ts'
import { bootSystem } from './test-support.ts'

const manual: ManagerRecord = {
    id: 'm1',
    ...DEFAULT_MANAGER_RECORDS.servers,
    scalingMode: 'manual',
    maxUtilization: 0.6,
}

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: ManagerRecord[], order: 'mirror first' | 'mirror last' = 'mirror first') => {
    const source = new MemoryRecordSource<ManagerRecord>(records)
    const mirror = (context: DemoContext) => new ManagerRecords(context, source, useManagerStore(context.pinia))
    const servers = (context: DemoContext) =>
        new ServerManager(context, new MemoryRecordSource<ServerRecord>(), useServerStore(context.pinia), source)
    const booted =
        order === 'mirror first'
            ? await bootSystem<[ManagerRecords, ServerManager]>([mirror, servers])
            : await bootSystem<[ServerManager, ManagerRecords]>([servers, mirror])

    systems.push(booted.system)

    const serverManager = booted.managers.find(manager => manager instanceof ServerManager) as ServerManager

    /** The manager records as the store has them: what each manager watches for its own. */
    const stored = () => Object.values(useManagerStore(booted.context.pinia).records)

    return { ...booted, source, serverManager, stored }
}

afterEach(async () => {
    for (const system of systems) await system.shutdown()
    systems = []
})

describe('the store', () => {
    test('the records there are, are loaded into it', async () => {
        const { stored } = await boot([manual])

        expect(stored()).toEqual([manual])
    })

    test("a record a manager creates for itself arrives in it, with an ID that is the source's to give", async () => {
        const { stored } = await boot([])

        expect(stored()).toEqual([{ id: expect.any(String), ...DEFAULT_MANAGER_RECORDS.servers }])
    })

    test('after the shutdown it no longer follows the data service', async () => {
        const { system, source, stored } = await boot([manual])

        await system.shutdown()
        await source.patch('m1', { maxUtilization: 0.9 })

        expect(stored()).toEqual([manual])
    })
})

describe.each(['mirror first', 'mirror last'] as const)('the order of the managers: %s', order => {
    test('the server manager sees its settings in the store', async () => {
        const { serverManager } = await boot([manual], order)

        expect(serverManager.scalingMode).toBe('manual')
    })

    test('with no record, it creates its own, once, and it arrives in the store', async () => {
        const { source, stored } = await boot([], order)

        expect(await source.find()).toHaveLength(1)
        expect(stored()).toEqual(await source.find())
    })

    test('a change over the route reaches the server manager through the store', async () => {
        const { serverManager, stored, send } = await boot([manual], order)

        expect(await send(createUpdateManagerCommand('servers', { scalingMode: 'automatic' }))).toEqual({
            status: 'accepted',
        })

        expect(stored()).toEqual([{ ...manual, scalingMode: 'automatic' }])
        expect(serverManager.scalingMode).toBe('automatic')
    })

    test('what the server manager reports arrives in the store', async () => {
        const { context, clock, stored } = await boot([manual], order)

        // No server takes commands in manual mode until one is there: the first is created at the start
        for (const userId of ['u1', 'u2', 'u3', 'u4']) {
            context.events.emit('commandRequested', { commandId: `c-${userId}`, userId, type: 'agentic' })
        }
        await clock.advance(100)

        expect(stored()[0]).toMatchObject({ scalingMode: 'manual', queueLength: 2, waitingForRoom: 2 })
    })
})
