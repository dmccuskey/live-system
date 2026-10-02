// The live server whole: a real data service, a real connection, commands over HTTP.
import { afterEach, describe, expect, test } from 'bun:test'
import { createAddServerCommand, createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { AddUserResult } from '@virtual-infrastructure/protocol/users/users.commands'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { FeathersConnection } from 'feathers-connect'
import type { Command, CommandResponse } from 'live-system/core'
import { createDataService, type DataService } from '../../data-service/src/app.ts'
import { createLiveServer, type LiveServer } from './app.ts'
import { collect, TIME_SCALE, until } from './test-support.ts'

let dataServices: DataService[] = []
let liveServers: LiveServer[] = []
let connections: FeathersConnection[] = []

const startDataService = async () => {
    const dataService = createDataService({ port: 0, filename: ':memory:' })

    dataServices.push(dataService)

    return `http://localhost:${await dataService.start()}`
}

const startLiveServer = async (dataServiceUrl: string) => {
    const liveServer = createLiveServer({ dataServiceUrl, port: 0, timeScale: TIME_SCALE })

    liveServers.push(liveServer)

    const port = await liveServer.start()
    const send = async <R = unknown>(command: Command): Promise<CommandResponse<R>> => {
        const response = await fetch(`http://localhost:${port}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command),
        })

        return (await response.json()) as CommandResponse<R>
    }

    return { liveServer, send }
}

const connect = async (url: string) => {
    const connection = new FeathersConnection({ url })

    connections.push(connection)
    await connection.connect()

    return {
        users: connection.recordSource<UserRecord>(SERVICES.users),
        servers: connection.recordSource<ServerRecord>(SERVICES.servers),
    }
}

const result = <R>(response: CommandResponse<R>): R => {
    if (response.status !== 'accepted') throw new Error(`The command failed: ${response.error.message}`)

    return response.result as R
}

afterEach(async () => {
    for (const liveServer of liveServers) await liveServer.stop()
    for (const connection of connections) await connection.disconnect()
    for (const dataService of dataServices) await dataService.stop()
    liveServers = []
    connections = []
    dataServices = []
})

describe('a first start', () => {
    test('there is a server and a user, and the system works without any input', async () => {
        const url = await startDataService()
        const { users, servers } = await connect(url)
        const loads: number[] = []
        servers.onPatched(record => loads.push(record.load))

        const { liveServer } = await startLiveServer(url)
        const finished = collect(liveServer.events, 'commandFinished')

        const [server] = await servers.find()
        const [user] = await users.find()

        expect(server).toMatchObject({ name: 'Server 1', capacity: 10 })
        expect(user).toMatchObject({ name: 'Alice', frustration: 0 })

        await until(() => finished.length >= 2, 10_000)

        expect(finished[0]).toMatchObject({ userId: user?.id, serverId: server?.id, outcome: 'completed' })
        expect(Math.max(...loads)).toBeGreaterThan(0)
        expect(Math.max(...loads)).toBeLessThanOrEqual(10)
    }, 15_000)

    test('a second start creates nothing more, and clears the load an earlier run left', async () => {
        const url = await startDataService()
        const { users, servers } = await connect(url)

        await users.create({ name: 'Zed', commandsPerMinute: 0, commandMix: { search: 1, standard: 0, agentic: 0 }, frustration: 0 })
        const stale = await servers.create({ name: 'Server 4', capacity: 10, load: 7, activeCommands: 3 })

        await startLiveServer(url)

        expect((await users.find()).map(record => record.name)).toEqual(['Zed'])
        expect(await servers.find()).toEqual([{ ...stale, load: 0, activeCommands: 0 }])
    })
})

describe('commands', () => {
    // A user that requests nothing, so the only commands are the test's own
    const quiet = async (url: string) => {
        const sources = await connect(url)

        await sources.users.create({
            name: 'Quiet',
            commandsPerMinute: 0,
            commandMix: { search: 1, standard: 0, agentic: 0 },
            frustration: 0,
        })

        return sources
    }

    test('servers and users are added and removed over HTTP', async () => {
        const url = await startDataService()
        const { users, servers } = await quiet(url)
        const { send } = await startLiveServer(url)

        const server = result(await send<AddServerResult>(createAddServerCommand()))
        const user = result(await send<AddUserResult>(createAddUserCommand()))

        expect((await servers.get(server.id)).name).toBe('Server 2')
        expect((await users.get(user.id)).name).toBe('Alice')

        expect(await send(createRemoveServerCommand(server.id))).toEqual({ status: 'accepted' })
        expect(await send(createRemoveUserCommand(user.id))).toEqual({ status: 'accepted' })

        expect(await servers.find()).toHaveLength(1)
        expect((await users.find()).map(record => record.name)).toEqual(['Quiet'])
    })

    test('a command requested raises the server record\'s load, and its end lowers it', async () => {
        const url = await startDataService()
        const { servers } = await quiet(url)
        const seen: ServerRecord[] = []
        servers.onPatched(record => seen.push(record))
        const { liveServer } = await startLiveServer(url)
        const started = collect(liveServer.events, 'commandStarted')

        liveServer.events.emit('commandRequested', { commandId: 'c1', userId: 'someone', type: 'agentic' })

        const serverId = started[0]?.serverId as string

        await until(() => seen.some(record => record.load === 4))
        await until(() => seen.at(-1)?.load === 0)

        expect(seen.map(record => [record.id, record.load, record.activeCommands])).toEqual([
            [serverId, 4, 1],
            [serverId, 0, 0],
        ])
    })

    test('a command that finds the server full waits, and runs when there is room', async () => {
        const url = await startDataService()
        await quiet(url)
        const { liveServer } = await startLiveServer(url)
        const queued = collect(liveServer.events, 'commandQueued')
        const refused = collect(liveServer.events, 'commandRefused')
        const finished = collect(liveServer.events, 'commandFinished')

        for (const userId of ['u1', 'u2', 'u3']) {
            liveServer.events.emit('commandRequested', { commandId: `c-${userId}`, userId, type: 'agentic' })
        }
        liveServer.events.emit('commandRequested', { commandId: 'c-again', userId: 'u3', type: 'search' })

        expect(queued.map(event => event.commandId)).toEqual(['c-u3'])
        expect(refused.map(event => [event.commandId, event.reason])).toEqual([['c-again', 'queue_full']])

        await until(() => finished.length === 3)

        expect(finished.map(event => event.outcome)).toEqual(['completed', 'completed', 'completed'])
    })

    test('a removed user\'s waiting command is dropped', async () => {
        const url = await startDataService()
        const { users } = await quiet(url)
        const { liveServer, send } = await startLiveServer(url)
        const refused = collect(liveServer.events, 'commandRefused')
        const [user] = await users.find()
        const userId = user?.id as string

        for (const other of ['u1', 'u2']) {
            liveServer.events.emit('commandRequested', { commandId: `c-${other}`, userId: other, type: 'agentic' })
        }
        liveServer.events.emit('commandRequested', { commandId: 'c-waiting', userId, type: 'agentic' })
        await send(createRemoveUserCommand(userId))

        expect(refused.map(event => [event.commandId, event.reason])).toEqual([['c-waiting', 'dropped']])
    })

    test('there is no route to run a command by', async () => {
        const url = await startDataService()
        await quiet(url)
        const { send } = await startLiveServer(url)

        expect(await send({ route: 'servers/run-command', data: { userId: 'someone', type: 'search' } })).toMatchObject({
            status: 'failed',
            error: { code: 'not_found' },
        })
    })
})

describe('starting and stopping', () => {
    test('without a data service the start fails', async () => {
        const liveServer = createLiveServer({ dataServiceUrl: 'http://localhost:1', port: 0 })

        expect(liveServer.start()).rejects.toThrow('Could not connect')
    })

    test('a stopped live server takes no more commands and leaves the records', async () => {
        const url = await startDataService()
        const { servers } = await connect(url)
        const { liveServer, send } = await startLiveServer(url)

        await liveServer.stop()

        expect(send(createAddServerCommand())).rejects.toThrow()
        expect(await servers.find()).toHaveLength(1)
    })
})
