// The web app's system whole: a real data service and a real live server, commands over HTTP.
import { createUpdateManagerCommand } from '@virtual-infrastructure/protocol/managers/managers.commands'
import { afterEach, describe, expect, test } from 'bun:test'
import { createAddServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { FeathersConnection } from 'feathers-connect'
import { createDataService, type DataService } from '../../data-service/src/app.ts'
import { createLiveServer, type LiveServer } from '../../live-server/src/app.ts'
import { createWebApp, type WebApp } from './app.ts'
import { useServerManagerRecord, useServers, useUsers } from './composables/records.ts'
import { until } from './test-support.ts'

let dataServices: DataService[] = []
let liveServers: LiveServer[] = []
let webApps: WebApp[] = []

afterEach(async () => {
    for (const webApp of webApps) await webApp.stop()
    for (const liveServer of liveServers) await liveServer.stop()
    for (const dataService of dataServices) await dataService.stop()

    webApps = []
    liveServers = []
    dataServices = []
})

/** A data service and a live server, each on a free port, and a web app for them, not yet started. */
const setUp = async () => {
    const dataService = createDataService({ port: 0, filename: ':memory:' })

    dataServices.push(dataService)

    const dataServiceUrl = `http://localhost:${await dataService.start()}`
    const liveServer = createLiveServer({ dataServiceUrl, port: 0, timeScale: 0.01 })

    liveServers.push(liveServer)

    const commandUrl = `http://localhost:${await liveServer.start()}/command`
    const webApp = createWebApp({ dataServiceUrl, commandUrl })

    webApps.push(webApp)

    return { dataService, liveServer, webApp, commandUrl }
}

/** Creates users in the data service as another client would, without a live server. */
const createUsers = async (dataServiceUrl: string, ...names: string[]) => {
    const connection = new FeathersConnection({ url: dataServiceUrl })
    const users = connection.recordSource<UserRecord>(SERVICES.users)

    await connection.connect()

    for (const name of names) {
        await users.create({
            name,
            commandsPerMinute: 0,
            commandMix: { search: 1, standard: 0, agentic: 0 },
            frustration: 0,
        })
    }

    await connection.disconnect()
}

describe('the web app', () => {
    test('is created without connecting', async () => {
        const webApp = createWebApp({ dataServiceUrl: 'http://localhost:1', commandUrl: 'http://localhost:1/command' })

        webApps.push(webApp)

        expect(webApp.status.phase).toBe('created')
        expect(webApp.isConnected.value).toBe(false)
    })

    test('start() connects and loads every store', async () => {
        const { webApp } = await setUp()

        const started = webApp.start()

        expect(webApp.status.phase).toBe('starting')
        await started

        expect(webApp.status.phase).toBe('running')
        expect(webApp.isConnected.value).toBe(true)

        // What the live server creates on a first start
        expect(useUsers(webApp.pinia).value).toHaveLength(1)
        // The first user is at work already, so automatic scaling may have added to the first server
        expect(useServers(webApp.pinia).value[0]).toMatchObject({ name: 'Server 1' })
        expect(useServerManagerRecord(webApp.pinia).value).toMatchObject({
            scalingMode: 'automatic',
            maxUtilization: 0.75,
        })
        expect('id' in useServerManagerRecord(webApp.pinia).value).toBe(true)
    })

    test('a failed start is reported in the status', async () => {
        const webApp = createWebApp({ dataServiceUrl: 'http://localhost:1', commandUrl: 'http://localhost:1/command' })

        webApps.push(webApp)
        await webApp.start()

        expect(webApp.status.phase).toBe('failed')
        expect(webApp.status.error).toBeInstanceOf(Error)
        expect(webApp.isConnected.value).toBe(false)
    })

    test('a command changes the store, by way of the live server and the data service', async () => {
        const { webApp } = await setUp()
        const users = useUsers(webApp.pinia)

        await webApp.start()

        expect(await webApp.commands.send(createAddUserCommand())).toBe(true)
        await until(() => users.value.length === 2)

        const last = users.value[1]

        expect(await webApp.commands.send(createRemoveUserCommand(last!.id))).toBe(true)
        await until(() => users.value.length === 1)
    })

    test('a change of the settings arrives in the manager store', async () => {
        const { webApp } = await setUp()
        const settings = useServerManagerRecord(webApp.pinia)

        await webApp.start()
        await webApp.commands.send(
            createUpdateManagerCommand('servers', { scalingMode: 'manual', maxUtilization: 0.5 }),
        )

        await until(() => settings.value.scalingMode === 'manual')
        expect(settings.value.maxUtilization).toBe(0.5)
    })

    test('a refused command is reported in the sender`s error', async () => {
        const { webApp } = await setUp()

        await webApp.start()

        // The mode is automatic at first
        expect(await webApp.commands.send(createAddServerCommand())).toBe(false)
        expect(webApp.commands.error.value).toBeString()
    })

    test('a command to a server that is not there is reported too', async () => {
        const webApp = createWebApp({ dataServiceUrl: 'http://localhost:1', commandUrl: 'http://localhost:1/command' })

        webApps.push(webApp)

        expect(await webApp.commands.send(createAddUserCommand())).toBe(false)
        expect(webApp.commands.error.value).toContain('cannot be reached')
    })

    test('a lost connection is reported after startup', async () => {
        const { webApp, liveServer, dataService } = await setUp()

        await webApp.start()
        await liveServer.stop()
        await dataService.stop()

        await until(() => !webApp.isConnected.value)
        expect(webApp.status.phase).toBe('running')
    })

    test('after the data service is restarted, the stores hold what it holds now', async () => {
        const first = createDataService({ port: 0, filename: ':memory:' })

        dataServices.push(first)

        const port = await first.start()
        const dataServiceUrl = `http://localhost:${port}`
        const webApp = createWebApp({ dataServiceUrl, commandUrl: 'http://localhost:1/command' })
        const names = () => useUsers(webApp.pinia).value.map(user => user.name)

        webApps.push(webApp)

        await createUsers(dataServiceUrl, 'Alice', 'Bob')
        await webApp.start()

        expect(names()).toEqual(['Alice', 'Bob'])

        // Killed: a data service that keeps its records in memory comes back without them
        await first.stop()
        await until(() => !webApp.isConnected.value)

        const second = createDataService({ port, filename: ':memory:' })

        dataServices.push(second)
        await second.start()
        await createUsers(dataServiceUrl, 'Carol')

        // No event said that Alice and Bob are gone: only fetching again shows it
        await until(() => webApp.isConnected.value && names().join() === 'Carol', 8_000)
        expect(webApp.status.phase).toBe('running')
    }, 10_000)

    test('stop() stops the system, disconnects and clears the error', async () => {
        const { webApp } = await setUp()

        await webApp.start()
        await webApp.commands.send(createAddServerCommand())
        await webApp.stop()

        expect(webApp.status.phase).toBe('stopped')
        expect(webApp.isConnected.value).toBe(false)
        expect(webApp.commands.error.value).toBeUndefined()
    })

    test('after stop() the stores no longer follow the data service', async () => {
        const { webApp, commandUrl } = await setUp()
        const users = useUsers(webApp.pinia)

        await webApp.start()
        await webApp.stop()

        const response = await fetch(commandUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createAddUserCommand()),
        })

        expect(response.status).toBe(200)
        await new Promise(resolve => setTimeout(resolve, 50))

        expect(users.value).toHaveLength(1)
    })
})
