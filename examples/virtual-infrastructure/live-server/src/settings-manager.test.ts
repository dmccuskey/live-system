import { afterEach, describe, expect, test } from 'bun:test'
import { createUpdateSettingsCommand } from '@virtual-infrastructure/protocol/settings/settings.commands'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '@virtual-infrastructure/protocol/settings/settings.constants'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import { MemoryRecordSource } from 'live-system/core'
import type { LiveSystem } from 'live-system/core'
import type { DemoContext } from './context.ts'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { ServerManager } from './server-manager.ts'
import { SettingsManager } from './settings-manager.ts'
import { useServerStore, useSettingsStore } from './stores.ts'
import { bootSystem, createContext } from './test-support.ts'

const manual: SettingsRecord = { id: 'x1', key: SETTINGS_KEYS.servers, scalingMode: 'manual', maxUtilization: 0.6 }

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: SettingsRecord[] = []) => {
    const source = new MemoryRecordSource<SettingsRecord>(records)
    const booted = await bootSystem<[SettingsManager]>([
        context => new SettingsManager(context, source, useSettingsStore(context.pinia)),
    ])

    systems.push(booted.system)

    /** The settings as the store has them: what the managers they are for watch. */
    const stored = () => Object.values(useSettingsStore(booted.context.pinia).records)

    return { ...booted, source, stored }
}

afterEach(async () => {
    for (const system of systems) await system.shutdown()
    systems = []
})

describe('the start', () => {
    test("with no settings record, the server manager's is created with its defaults, and is in the store", async () => {
        const { source, stored } = await boot()

        const id = expect.any(String)

        expect(await source.find()).toEqual([{ id, key: 'servers', scalingMode: 'automatic', maxUtilization: 0.75 }])
        expect(stored()).toEqual([{ id, ...DEFAULT_SETTINGS.servers }])
    })

    test('the settings there are, are kept and loaded into the store', async () => {
        const { source, stored } = await boot([manual])

        expect(await source.find()).toEqual([manual])
        expect(stored()).toEqual([manual])
    })

    test("a record carries the key of the manager it is for, and its ID is the source's to give", async () => {
        const { stored } = await boot()

        expect(stored()[0]?.key).toBe(SETTINGS_KEYS.servers)
        expect(stored()[0]?.id).not.toBe(SETTINGS_KEYS.servers)
    })

    test("settings with another key do not stand in for the server manager's", async () => {
        const other: SettingsRecord = { ...manual, id: 'x2', key: 'users' }
        const { source } = await boot([other])

        expect((await source.find()).map(record => record.key)).toEqual(['users', 'servers'])
    })
})

describe('the records there must be', () => {
    test('they are there once init() is done, before anything starts', async () => {
        const source = new MemoryRecordSource<SettingsRecord>()
        const context = createContext()
        const manager = new SettingsManager(context, source, useSettingsStore(context.pinia))

        await manager.init()

        expect(Object.values(useSettingsStore(context.pinia).records).map(record => record.key)).toEqual(
            Object.values(SETTINGS_KEYS),
        )
        await manager.stop()
    })

    test('init() waits for a created record whose event comes after the create has answered', async () => {
        /** A source whose created events arrive late, as they may over a network. */
        class LateSource extends MemoryRecordSource<SettingsRecord> {
            override onCreated(listener: (record: SettingsRecord) => void) {
                return super.onCreated(record => setTimeout(() => listener(record), 20))
            }
        }

        const context = createContext()
        const store = useSettingsStore(context.pinia)
        const manager = new SettingsManager(context, new LateSource(), store)

        await manager.init()

        expect(Object.values(store.records)).toMatchObject([{ key: 'servers', scalingMode: 'automatic' }])
        await manager.stop()
    })

    test('a stop lets go of an init() that still waits', async () => {
        class SilentSource extends MemoryRecordSource<SettingsRecord> {
            override onCreated() {
                return () => {}
            }
        }

        const context = createContext()
        const manager = new SettingsManager(context, new SilentSource(), useSettingsStore(context.pinia))
        const init = manager.init()

        await Bun.sleep(5)
        await manager.stop()

        expect(await init).toBeUndefined()
    })

    test('a second start creates no second record', async () => {
        const first = await boot()
        const records = await first.source.find()
        await first.system.shutdown()

        const second = await boot(records)

        expect(await second.source.find()).toEqual(records)
    })
})

describe('the order of the managers', () => {
    const settingsManager = (context: DemoContext) =>
        new SettingsManager(context, new MemoryRecordSource<SettingsRecord>(), useSettingsStore(context.pinia))
    const serverManager = (context: DemoContext) =>
        new ServerManager(context, new MemoryRecordSource<ServerRecord>(), useServerStore(context.pinia))

    test('a manager added after the settings manager sees its settings in the store', async () => {
        const booted = await bootSystem<[SettingsManager, ServerManager]>([settingsManager, serverManager])

        systems.push(booted.system)

        expect(booted.managers[1].scalingMode).toBe('automatic')
    })

    test('and so does one added before', async () => {
        const booted = await bootSystem<[ServerManager, SettingsManager]>([serverManager, settingsManager])

        systems.push(booted.system)

        expect(booted.managers[0].scalingMode).toBe('automatic')
    })

    test('a change over the route reaches the server manager through the store', async () => {
        const booted = await bootSystem<[ServerManager, SettingsManager]>([serverManager, settingsManager])

        systems.push(booted.system)
        await booted.send(createUpdateSettingsCommand('servers', { scalingMode: 'manual' }))

        expect(booted.managers[0].scalingMode).toBe('manual')
    })
})

describe('settings/:key/update', () => {
    test('the mode is changed in the data service, and the change comes back into the store', async () => {
        const { source, stored, send } = await boot([manual])

        expect(await send(createUpdateSettingsCommand('servers', { scalingMode: 'automatic' }))).toEqual({
            status: 'accepted',
        })

        expect(await source.get('x1')).toEqual({ ...manual, scalingMode: 'automatic' })
        expect(stored()).toEqual([{ ...manual, scalingMode: 'automatic' }])
    })

    test('the maximum utilization is changed, and the mode stays', async () => {
        const { source, send } = await boot([manual])

        await send(createUpdateSettingsCommand('servers', { maxUtilization: 0.9 }))

        expect(await source.get('x1')).toEqual({ ...manual, maxUtilization: 0.9 })
    })

    test('both are changed at once', async () => {
        const { source, send } = await boot([manual])

        await send(createUpdateSettingsCommand('servers', { scalingMode: 'automatic', maxUtilization: 0.3 }))

        expect(await source.get('x1')).toEqual({ ...manual, scalingMode: 'automatic', maxUtilization: 0.3 })
    })

    test.each([
        ['an unknown mode', { scalingMode: 'sometimes' }],
        ['a maximum that is too low', { maxUtilization: 0.29 }],
        ['a maximum that is too high', { maxUtilization: 0.96 }],
        ['a maximum that is not a number', { maxUtilization: '0.5' }],
        ['a maximum that is NaN', { maxUtilization: Number.NaN }],
        ['nothing to change', {}],
        ['no data', undefined],
        ['only what is not a setting', { id: 'other', key: 'users', name: 'x' }],
    ])('%s is a bad request, and nothing is written', async (_name, data) => {
        const { source, stored, send } = await boot([manual])

        expect(await send({ route: 'settings/servers/update', data })).toMatchObject({
            status: 'failed',
            error: { code: 'bad_request' },
        })
        expect(await source.find()).toEqual([manual])
        expect(stored()).toEqual([manual])
    })

    test('what is not a setting is left out of what is written', async () => {
        const { source, send } = await boot([manual])

        await send({
            route: 'settings/servers/update',
            data: { maxUtilization: 0.5, id: 'other', key: 'users', extra: true },
        })

        expect(await source.find()).toEqual([{ ...manual, maxUtilization: 0.5 }])
    })

    test('settings that do not exist are not_found', async () => {
        const { send } = await boot([manual])

        expect(await send(createUpdateSettingsCommand('users', { scalingMode: 'manual' }))).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })
})

describe('stopping', () => {
    test('after the shutdown the store no longer follows the data service, and the route is gone', async () => {
        const { system, source, stored, send } = await boot([manual])

        await system.shutdown()
        await source.patch('x1', { maxUtilization: 0.4 })

        expect(stored()).toEqual([manual])
        expect(await send(createUpdateSettingsCommand('servers', { maxUtilization: 0.5 }))).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })
})
