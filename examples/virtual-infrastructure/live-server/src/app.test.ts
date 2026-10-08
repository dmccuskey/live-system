// The live server whole: a real data service, a real connection, commands over HTTP.
import { createUpdateManagerCommand } from '@virtual-infrastructure/protocol/managers/managers.commands'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import {
    createAddServerCommand,
    createRemoveServerCommand,
} from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { AddUserResult } from '@virtual-infrastructure/protocol/users/users.commands'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { FeathersConnection } from 'feathers-connect'
import { FakeClock } from 'live-system/core'
import type { Command, CommandResponse } from 'live-system/core'
import { createDataService, type DataService } from '../../data-service/src/app.ts'
import { createLiveServer, type LiveServer } from './app.ts'
import { advanceUntilArrived, collect } from './test-support.ts'

let dataServices: DataService[] = []
let liveServers: LiveServer[] = []
let connections: FeathersConnection[] = []

const startDataService = async () => {
    const dataService = createDataService({ port: 0, filename: ':memory:' })

    dataServices.push(dataService)

    return `http://localhost:${await dataService.start()}`
}

const startLiveServer = async (dataServiceUrl: string) => {
    // The simulation runs on a clock the test moves: only the network runs on real time
    const clock = new FakeClock()
    const liveServer = createLiveServer({ dataServiceUrl, port: 0, clock })

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

    return { liveServer, send, clock }
}

const connect = async (url: string) => {
    const connection = new FeathersConnection({ url })

    connections.push(connection)
    await connection.connect()

    return {
        users: connection.recordSource<UserRecord>(SERVICES.users),
        servers: connection.recordSource<ServerRecord>(SERVICES.servers),
        managers: connection.recordSource<ManagerRecord>(SERVICES.managers),
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

        const { liveServer, clock } = await startLiveServer(url)
        const finished = collect(liveServer.events, 'commandFinished')

        const [server] = await servers.find()
        const [user] = await users.find()

        expect(server).toMatchObject({ name: 'Server 1', capacity: 10 })
        expect(user).toMatchObject({ name: 'Alice', frustration: 0 })

        await advanceUntilArrived(clock, () => finished.length >= 2, 10_000)

        expect(finished[0]).toMatchObject({ userId: user?.id, serverId: server?.id, outcome: 'completed' })
        expect(Math.max(...loads)).toBeGreaterThan(0)
        expect(Math.max(...loads)).toBeLessThanOrEqual(10)
    }, 15_000)

    test('a second start creates nothing more, and clears the load an earlier run left', async () => {
        const url = await startDataService()
        const { users, servers } = await connect(url)

        await users.create({
            name: 'Zed',
            commandsPerMinute: 0,
            commandMix: { search: 1, standard: 0, agentic: 0 },
            frustration: 0,
        })
        const stale = await servers.create({
            name: 'Server 4',
            capacity: 10,
            load: 7,
            activeCommands: 3,
            isDraining: false,
        })

        await startLiveServer(url)

        expect((await users.find()).map(record => record.name)).toEqual(['Zed'])
        expect(await servers.find()).toEqual([{ ...stale, load: 0, activeCommands: 0, isDraining: false }])
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

        await send(createUpdateManagerCommand('servers', { scalingMode: 'manual' }))

        const server = result(await send<AddServerResult>(createAddServerCommand()))
        const user = result(await send<AddUserResult>(createAddUserCommand()))

        expect((await servers.get(server.id)).name).toBe('Server 2')
        expect((await users.get(user.id)).name).toBe('Alice')

        expect(await send(createRemoveServerCommand(server.id))).toEqual({ status: 'accepted' })
        expect(await send(createRemoveUserCommand(user.id))).toEqual({ status: 'accepted' })

        expect(await servers.find()).toHaveLength(1)
        expect((await users.find()).map(record => record.name)).toEqual(['Quiet'])
    })

    test("a command requested raises the server record's load, and its end lowers it", async () => {
        const url = await startDataService()
        const { servers } = await quiet(url)
        const seen: ServerRecord[] = []
        servers.onPatched(record => seen.push(record))
        const { liveServer, clock } = await startLiveServer(url)
        const started = collect(liveServer.events, 'commandStarted')

        liveServer.events.emit('commandRequested', { commandId: 'c1', userId: 'someone', type: 'agentic' })

        const serverId = started[0]?.serverId as string

        await advanceUntilArrived(clock, () => seen.some(record => record.load === 4))
        await advanceUntilArrived(clock, () => seen.at(-1)?.load === 0)

        expect(seen.map(record => [record.id, record.load, record.activeCommands])).toEqual([
            [serverId, 4, 1],
            [serverId, 0, 0],
        ])
    })

    test('a command that finds the server full waits, and runs when there is room', async () => {
        const url = await startDataService()
        await quiet(url)
        const { liveServer, clock } = await startLiveServer(url)
        const queued = collect(liveServer.events, 'commandQueued')
        const refused = collect(liveServer.events, 'commandRefused')
        const finished = collect(liveServer.events, 'commandFinished')

        for (const userId of ['u1', 'u2', 'u3']) {
            liveServer.events.emit('commandRequested', { commandId: `c-${userId}`, userId, type: 'agentic' })
        }
        liveServer.events.emit('commandRequested', { commandId: 'c-again', userId: 'u3', type: 'search' })

        expect(queued.map(event => event.commandId)).toEqual(['c-u3'])
        expect(refused.map(event => [event.commandId, event.reason])).toEqual([['c-again', 'queue_full']])

        await advanceUntilArrived(clock, () => finished.length === 3)

        expect(finished.map(event => event.outcome)).toEqual(['completed', 'completed', 'completed'])
    })

    test("a removed user's waiting command is dropped", async () => {
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

        expect(await send({ route: 'servers/run-command', data: { userId: 'someone', type: 'search' } })).toMatchObject(
            {
                status: 'failed',
                error: { code: 'not_found' },
            },
        )
    })
})

describe("the server manager's record, and scaling", () => {
    const quietUser = {
        name: 'Quiet',
        commandsPerMinute: 0,
        commandMix: { search: 1, standard: 0, agentic: 0 },
        frustration: 0,
    }

    test("a first start creates the server manager's record", async () => {
        const url = await startDataService()
        const { users, managers } = await connect(url)
        // No commands, so the utilization stays as the start leaves it
        await users.create(quietUser)

        await startLiveServer(url)

        const id = expect.stringMatching(/^[0-9a-f-]{36}$/)

        expect(await managers.find()).toEqual([
            {
                id,
                key: 'servers',
                scalingMode: 'automatic',
                maxUtilization: 0.75,
                queueLength: 0,
                waitingForRoom: 0,
                utilization: 0,
            },
        ])
    })

    test('a second start keeps the settings', async () => {
        const url = await startDataService()
        const { managers } = await connect(url)
        const first = await startLiveServer(url)

        await first.send(createUpdateManagerCommand('servers', { scalingMode: 'manual', maxUtilization: 0.5 }))
        await first.liveServer.stop()

        const second = await startLiveServer(url)

        expect(await managers.find()).toMatchObject([{ key: 'servers', scalingMode: 'manual', maxUtilization: 0.5 }])
        expect(result(await second.send<AddServerResult>(createAddServerCommand())).id).toBeDefined()
    })

    test('the settings are changed over HTTP, and decide whether servers may be added by hand', async () => {
        const url = await startDataService()
        const { users, managers } = await connect(url)
        await users.create(quietUser)
        const { send } = await startLiveServer(url)

        expect(await send(createAddServerCommand())).toMatchObject({
            status: 'failed',
            error: { code: 'automatic_mode' },
        })
        expect(await send(createUpdateManagerCommand('servers', { maxUtilization: 2 }))).toMatchObject({
            status: 'failed',
            error: { code: 'bad_request' },
        })

        expect(await send(createUpdateManagerCommand('servers', { scalingMode: 'manual' }))).toEqual({
            status: 'accepted',
        })

        expect(await managers.find()).toMatchObject([{ key: 'servers', scalingMode: 'manual', maxUtilization: 0.75 }])
        expect(await send(createAddServerCommand())).toMatchObject({ status: 'accepted' })
    })

    test('in automatic mode a server is added under load, and removed once it is idle', async () => {
        const url = await startDataService()
        const { users, servers } = await connect(url)
        await users.create(quietUser)
        const created: string[] = []
        const removed: string[] = []
        servers.onCreated(record => created.push(record.name))
        servers.onRemoved(record => removed.push(record.name))
        const { liveServer, clock } = await startLiveServer(url)
        let isLoaded = true
        let count = 0
        const request = (userId: string) => {
            liveServer.events.emit('commandRequested', { commandId: `c${++count}`, userId, type: 'agentic' })
        }

        // The load is kept up until the server is there: however slowly the samples come, the policy sees it
        liveServer.events.on('commandFinished', ({ userId }) => {
            if (isLoaded) queueMicrotask(() => request(userId))
        })
        for (const userId of ['u1', 'u2', 'u3']) request(userId)

        await advanceUntilArrived(clock, () => created.includes('Server 2'), 5_000)
        isLoaded = false
        await advanceUntilArrived(clock, () => removed.length === 1, 5_000)

        // Which of the two goes depends on where the last commands ran: the ServerManager's tests cover the choice
        expect(removed).toHaveLength(1)
        expect(await servers.find()).toHaveLength(1)
    }, 15_000)

    test('the record follows the utilization of the servers', async () => {
        const url = await startDataService()
        const { users, managers } = await connect(url)
        await users.create(quietUser)
        const seen: number[] = []
        managers.onPatched(record => seen.push(record.utilization))
        const { liveServer, clock } = await startLiveServer(url)

        liveServer.events.emit('commandRequested', { commandId: 'c1', userId: 'someone', type: 'agentic' })

        // The average follows the command gradually, in whole percent, up to its load and back
        await advanceUntilArrived(clock, () => seen.includes(0.4))
        await advanceUntilArrived(clock, () => seen.at(-1) === 0)

        expect(Math.max(...seen)).toBe(0.4)
        expect(seen.length).toBeGreaterThan(2)
    })

    test('the record follows the queue', async () => {
        const url = await startDataService()
        const { users, managers } = await connect(url)
        await users.create(quietUser)
        const lengths: number[] = []
        managers.onPatched(record => lengths.push(record.queueLength))
        const { liveServer, send, clock } = await startLiveServer(url)
        const finished = collect(liveServer.events, 'commandFinished')

        await send(createUpdateManagerCommand('servers', { scalingMode: 'manual' }))
        for (const userId of ['u1', 'u2', 'u3']) {
            liveServer.events.emit('commandRequested', { commandId: `c-${userId}`, userId, type: 'agentic' })
        }

        await advanceUntilArrived(clock, () => lengths.includes(1))
        await advanceUntilArrived(clock, () => finished.length === 3)
        await advanceUntilArrived(clock, () => lengths.at(-1) === 0)

        // From the first command that waits: the change of the settings before it is a write of the record too
        const changes = lengths.slice(lengths.indexOf(1))

        expect(changes.filter((length, index) => length !== changes[index - 1])).toEqual([1, 0])
    })
})

describe('the time scale', () => {
    test('multiplies the durations on the clock: at 0.01 a search of 2 s ends after 20 ms', async () => {
        const url = await startDataService()
        const { users } = await connect(url)
        await users.create({
            name: 'Quiet',
            commandsPerMinute: 0,
            commandMix: { search: 1, standard: 0, agentic: 0 },
            frustration: 0,
        })
        const clock = new FakeClock()
        const liveServer = createLiveServer({ dataServiceUrl: url, port: 0, clock, timeScale: 0.01 })

        liveServers.push(liveServer)
        await liveServer.start()

        const finished = collect(liveServer.events, 'commandFinished')

        liveServer.events.emit('commandRequested', { commandId: 'c1', userId: 'someone', type: 'search' })

        await clock.advance(19)
        expect(finished).toEqual([])

        await clock.advance(1)
        expect(finished).toMatchObject([{ commandId: 'c1', outcome: 'completed' }])
    })
})

describe('a data service that is restarted', () => {
    test('the live server takes up a user created while it was away', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'virtual-infrastructure-'))
        const filename = join(directory, 'records.sqlite')
        const start = async (port: number) => {
            const dataService = createDataService({ port, filename })

            dataServices.push(dataService)

            return { dataService, port: await dataService.start() }
        }

        try {
            const first = await start(0)
            const { liveServer, clock } = await startLiveServer(`http://localhost:${first.port}`)
            const finished = collect(liveServer.events, 'commandFinished')

            await first.dataService.stop()

            // A data service over the same records on another port, which the live server
            // is not connected to: no event tells it of the user created here
            const aside = await start(0)
            const { users } = await connect(`http://localhost:${aside.port}`)
            const zed = await users.create({
                name: 'Zed',
                commandsPerMinute: 60,
                commandMix: { search: 1, standard: 0, agentic: 0 },
                frustration: 0,
            })

            await aside.dataService.stop()
            await start(first.port)

            // Zed has a live object once the live server has reconnected and fetched its records again
            await advanceUntilArrived(clock, () => finished.some(event => event.userId === zed.id), 10_000)
        } finally {
            for (const liveServer of liveServers) await liveServer.stop()

            rmSync(directory, { recursive: true, force: true })
        }
    }, 15_000)
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
