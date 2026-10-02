// The data service as its clients see it: through a real connection.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { FeathersConnection } from 'feathers-connect'
import { createDataService, type DataService } from './app.ts'

const alice: Omit<UserRecord, 'id'> = {
    name: 'Alice',
    commandsPerMinute: 8,
    commandMix: { search: 0.7, standard: 0.2, agentic: 0.1 },
    frustration: 0,
}
const server1: Omit<ServerRecord, 'id'> = { name: 'Server 1', capacity: 10, load: 0, activeCommands: 0, isDraining: false }

let services: DataService[] = []
let connections: FeathersConnection[] = []
let folders: string[] = []

const start = async (filename = ':memory:') => {
    const service = createDataService({ port: 0, filename })

    services.push(service)

    return { service, port: await service.start() }
}

const connect = async (port: number) => {
    const connection = new FeathersConnection({ url: `http://localhost:${port}` })

    connections.push(connection)
    await connection.connect()

    return connection
}

const temporaryFolder = () => {
    const folder = mkdtempSync(join(tmpdir(), 'data-service-'))

    folders.push(folder)

    return folder
}

/** Resolves with the next record the subscription hears. */
const next = <T>(subscribe: (listener: (record: T) => void) => unknown) => new Promise<T>(resolve => subscribe(resolve))

afterEach(async () => {
    for (const connection of connections) await connection.disconnect()
    for (const service of services) await service.stop()
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
    connections = []
    services = []
    folders = []
})

describe('records', () => {
    test('a created record gets a string id', async () => {
        const { port } = await start()
        const users = (await connect(port)).recordSource<UserRecord>(SERVICES.users)

        const created = await users.create(alice)

        expect(created).toEqual({ ...alice, id: expect.any(String) })
        expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
        expect(await users.get(created.id)).toEqual(created)
    })

    test('a given id is kept', async () => {
        const { port } = await start()
        const users = (await connect(port)).recordSource<UserRecord>(SERVICES.users)

        expect((await users.create({ ...alice, id: 'u1' })).id).toBe('u1')
    })

    test('find returns every record as an array', async () => {
        const { port } = await start()
        const servers = (await connect(port)).recordSource<ServerRecord>(SERVICES.servers)

        expect(await servers.find()).toEqual([])

        await servers.create({ ...server1, id: 's1' })
        await servers.create({ ...server1, id: 's2', name: 'Server 2' })

        expect((await servers.find()).map(server => server.id)).toEqual(['s1', 's2'])
    })

    test('users and servers are kept apart', async () => {
        const { port } = await start()
        const connection = await connect(port)

        await connection.recordSource<UserRecord>(SERVICES.users).create({ ...alice, id: 'u1' })

        expect(await connection.recordSource<ServerRecord>(SERVICES.servers).find()).toEqual([])
    })

    test('there is a service for the settings and one for the status', async () => {
        const { port } = await start()
        const connection = await connect(port)
        const settings = connection.recordSource<SettingsRecord>(SERVICES.settings)
        const status = connection.recordSource<StatusRecord>(SERVICES.status)

        const id = expect.stringMatching(/^[0-9a-f-]{36}$/)

        await settings.create({ key: 'servers', scalingMode: 'manual', maxUtilization: 0.75 })
        await status.create({ key: 'servers', queueLength: 2, utilization: 0.4 })

        expect(await settings.find()).toEqual([{ id, key: 'servers', scalingMode: 'manual', maxUtilization: 0.75 }])
        expect(await status.find()).toEqual([{ id, key: 'servers', queueLength: 2, utilization: 0.4 }])
    })

    test('patch, update and remove change the record', async () => {
        const { port } = await start()
        const servers = (await connect(port)).recordSource<ServerRecord>(SERVICES.servers)

        await servers.create({ ...server1, id: 's1' })

        expect(await servers.patch('s1', { load: 4, activeCommands: 1 })).toEqual({ ...server1, id: 's1', load: 4, activeCommands: 1 })
        expect(await servers.update('s1', { ...server1, id: 's1', capacity: 20 })).toEqual({ ...server1, id: 's1', capacity: 20 })
        expect(await servers.remove('s1')).toEqual({ ...server1, id: 's1', capacity: 20 })
        expect(await servers.find()).toEqual([])
    })

    test('a missing record rejects with NotFound', async () => {
        const { port } = await start()
        const users = (await connect(port)).recordSource<UserRecord>(SERVICES.users)

        expect(users.get('missing')).rejects.toMatchObject({ name: 'NotFound', code: 404 })
    })
})

describe('events', () => {
    test('another client hears each change', async () => {
        const { port } = await start()
        const writer = (await connect(port)).recordSource<UserRecord>(SERVICES.users)
        const listener = (await connect(port)).recordSource<UserRecord>(SERVICES.users)

        const created = next<UserRecord>(listen => listener.onCreated(listen))
        const patched = next<UserRecord>(listen => listener.onPatched(listen))
        const updated = next<UserRecord>(listen => listener.onUpdated(listen))
        const removed = next<UserRecord>(listen => listener.onRemoved(listen))

        await writer.create({ ...alice, id: 'u1' })
        expect(await created).toEqual({ ...alice, id: 'u1' })

        await writer.patch('u1', { frustration: 0.5 })
        expect(await patched).toEqual({ ...alice, id: 'u1', frustration: 0.5 })

        await writer.update('u1', { ...alice, id: 'u1', name: 'Alicia' })
        expect(await updated).toEqual({ ...alice, id: 'u1', name: 'Alicia' })

        await writer.remove('u1')
        expect(await removed).toEqual({ ...alice, id: 'u1', name: 'Alicia' })
    })
})

describe('start and stop', () => {
    test('records survive a restart on the same file', async () => {
        const filename = join(temporaryFolder(), 'records.sqlite')
        const first = await start(filename)
        const connection = await connect(first.port)

        await connection.recordSource<UserRecord>(SERVICES.users).create({ ...alice, id: 'u1' })
        await connection.disconnect()
        await first.service.stop()

        const second = await start(filename)
        const users = (await connect(second.port)).recordSource<UserRecord>(SERVICES.users)

        expect(await users.find()).toEqual([{ ...alice, id: 'u1' }])
    })

    test('the folder of the file is created when missing', async () => {
        const filename = join(temporaryFolder(), 'data', 'nested', 'records.sqlite')
        const { port } = await start(filename)

        await (await connect(port)).recordSource<UserRecord>(SERVICES.users).create(alice)

        expect(await Bun.file(filename).exists()).toBe(true)
    })

    test('stop frees the port, with a client still connected', async () => {
        const first = await start()

        await connect(first.port)
        await first.service.stop()

        const second = createDataService({ port: first.port, filename: ':memory:' })

        services.push(second)
        expect(await second.start()).toBe(first.port)
    })

    test('starting twice is an error', async () => {
        const { service } = await start()

        expect(service.start()).rejects.toThrow('already started')
    })

    test('stop is harmless before start and after stop', async () => {
        const service = createDataService({ port: 0, filename: ':memory:' })

        await service.stop()
        await service.start()
        await service.stop()
        await service.stop()
    })
})
