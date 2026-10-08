// The data service as its clients see it: through a real connection.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { FeathersConnection } from 'feathers-connect'
import { createDataService, type DataService } from './app.ts'

const alice: Omit<UserRecord, 'id'> = {
    name: 'Alice',
    commandsPerMinute: 8,
    commandMix: { search: 0.7, standard: 0.2, agentic: 0.1 },
    frustration: 0,
}
const server1: Omit<ServerRecord, 'id'> = {
    name: 'Server 1',
    capacity: 10,
    load: 0,
    activeCommands: 0,
    isDraining: false,
}

let services: DataService[] = []
let connections: FeathersConnection[] = []
let folders: string[] = []

const start = async (filename = ':memory:', writeToken?: string) => {
    const service = createDataService({ port: 0, filename, writeToken })

    services.push(service)

    return { service, port: await service.start() }
}

const connect = async (port: number, handshake?: Record<string, unknown>) => {
    const connection = new FeathersConnection({ url: `http://localhost:${port}`, handshake })

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

    test('there is a service for the manager records', async () => {
        const { port } = await start()
        const managers = (await connect(port)).recordSource<ManagerRecord>(SERVICES.managers)
        const record = {
            key: 'servers' as const,
            scalingMode: 'manual' as const,
            maxUtilization: 0.75,
            queueLength: 2,
            waitingForRoom: 0,
            utilization: 0.4,
        }

        await managers.create(record)

        expect(await managers.find()).toEqual([{ id: expect.stringMatching(/^[0-9a-f-]{36}$/), ...record }])
    })

    test('patch, update and remove change the record', async () => {
        const { port } = await start()
        const servers = (await connect(port)).recordSource<ServerRecord>(SERVICES.servers)

        await servers.create({ ...server1, id: 's1' })

        expect(await servers.patch('s1', { load: 4, activeCommands: 1 })).toEqual({
            ...server1,
            id: 's1',
            load: 4,
            activeCommands: 1,
        })
        expect(await servers.update('s1', { ...server1, id: 's1', capacity: 20 })).toEqual({
            ...server1,
            id: 's1',
            capacity: 20,
        })
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

describe('a write token', () => {
    const forbidden = { name: 'Forbidden', code: 403 }
    const usersOf = async (port: number, handshake?: Record<string, unknown>) =>
        (await connect(port, handshake)).recordSource<UserRecord>(SERVICES.users)

    test('a client with the token writes', async () => {
        const { port } = await start(':memory:', 'secret')
        const users = await usersOf(port, { writeToken: 'secret' })

        const created = await users.create(alice)

        await users.patch(created.id, { frustration: 1 })
        await users.update(created.id, { ...created, name: 'Alicia' })
        expect(await users.get(created.id)).toMatchObject({ name: 'Alicia' })
        await users.remove(created.id)
        expect(await users.find()).toEqual([])
    })

    test('a client without it reads, hears changes, and is refused every write', async () => {
        const { port } = await start(':memory:', 'secret')
        const writer = await usersOf(port, { writeToken: 'secret' })
        const reader = await usersOf(port)
        const heard = next<UserRecord>(listener => reader.onCreated(listener))
        const created = await writer.create(alice)

        expect(await heard).toEqual(created)
        expect(await reader.find()).toEqual([created])
        expect(await reader.get(created.id)).toEqual(created)

        const refused = await Promise.all(
            [
                reader.create(alice),
                reader.patch(created.id, { frustration: 1 }),
                reader.update(created.id, { ...created, name: 'Mallory' }),
                reader.remove(created.id),
            ].map(call =>
                call.then(
                    () => 'written',
                    error => error,
                ),
            ),
        )

        for (const outcome of refused) expect(outcome).toMatchObject(forbidden)
        expect(await reader.find()).toEqual([created])
    })

    test('a wrong token is refused, and so is one that is not a string', async () => {
        const { port } = await start(':memory:', 'secret')

        for (const writeToken of ['Secret', 'secret ', '', 7, null, ['secret']]) {
            const users = await usersOf(port, { writeToken })
            const outcome = await users.create(alice).then(
                () => 'written',
                error => error,
            )

            expect(outcome).toMatchObject(forbidden)
        }
    })

    test('every service is covered', async () => {
        const { port } = await start(':memory:', 'secret')
        const connection = await connect(port)

        for (const path of Object.values(SERVICES)) {
            const outcome = await connection
                .recordSource<{ id: string }>(path)
                .create({})
                .then(
                    () => 'written',
                    error => error,
                )

            expect(outcome).toMatchObject(forbidden)
        }
    })

    test('without a token configured every client writes', async () => {
        const { port } = await start()
        const users = await usersOf(port)

        expect(await users.create(alice)).toMatchObject({ name: 'Alice' })
    })
})

describe('the health address', () => {
    test('is 200 once the data service listens', async () => {
        const { port } = await start()
        const response = await fetch(`http://localhost:${port}/health`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ status: 'ok' })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
    })

    test('any other path is 404, and so is anything but GET', async () => {
        const { port } = await start()

        expect((await fetch(`http://localhost:${port}/users`)).status).toBe(404)
        expect((await fetch(`http://localhost:${port}/health`, { method: 'POST' })).status).toBe(404)
    })

    test('clients connect as before', async () => {
        const { port } = await start()

        await fetch(`http://localhost:${port}/health`)

        const connection = await connect(port)

        expect(await connection.recordSource<UserRecord>(SERVICES.users).find()).toEqual([])
    })

    test('a stopped data service does not answer', async () => {
        const { service, port } = await start()

        await service.stop()

        const outcome = await fetch(`http://localhost:${port}/health`).then(
            () => 'answered',
            () => 'refused',
        )

        expect(outcome).toBe('refused')
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
