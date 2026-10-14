// Connecting through the connection: keeping on trying, and hearing why an attempt failed. Against a real Feathers app in this process.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthenticationService, JWTStrategy, authenticate } from '@feathersjs/authentication'
import { LocalStrategy, hooks as localHooks } from '@feathersjs/authentication-local'
import { feathers } from '@feathersjs/feathers'
import { MemoryService } from '@feathersjs/memory'
import socketio from '@feathersjs/socketio'
import { FeathersConnection } from './connection.ts'

const LOGIN = { strategy: 'local', email: 'ada@example.com', password: 'secret' }

let port: number
let url: string
let app: any
let server: Server | undefined
const connections: FeathersConnection[] = []

// For a test that waits through several of socket.io's attempts: its waits between them grow to five seconds
const SLOW = 20_000

/** A port nothing listens on, for a data service that starts later. */
const freePort = async () => {
    const probe = createServer()

    await new Promise<void>(resolve => probe.listen(0, resolve))

    const { port } = probe.address() as AddressInfo

    await new Promise(resolve => probe.close(resolve))

    return port
}

/** Starts a data service on the port: `notes` for anyone, `items` for those logged in. */
const startDataService = async ({ isRefusing = false } = {}) => {
    app = feathers()

    app.configure(
        socketio((io: any) => {
            if (isRefusing) io.use((_socket: unknown, next: (error: Error) => void) => next(new Error('Not welcome')))
        }),
    )
    app.set('authentication', {
        secret: 'a test secret',
        entity: 'user',
        service: 'users',
        authStrategies: ['jwt', 'local'],
        jwtOptions: { header: { typ: 'access' }, audience: 'https://example.com', algorithm: 'HS256', expiresIn: '1d' },
        local: { usernameField: 'email', passwordField: 'password' },
    })

    const authentication = new AuthenticationService(app)
    authentication.register('jwt', new JWTStrategy())
    authentication.register('local', new LocalStrategy())
    app.use('authentication', authentication)

    app.use('users', new MemoryService({ id: 'id' }))
    app.service('users').hooks({ before: { create: [localHooks.hashPassword('password')] } })
    app.use('items', new MemoryService({ id: 'id' }))
    app.service('items').hooks({ before: { all: [authenticate('jwt')] } })
    app.use('notes', new MemoryService({ id: 'id' }))

    await app.service('users').create({ id: 'ada', email: LOGIN.email, password: LOGIN.password })

    server = (await app.listen(port)) as Server
}

/** Stops the data service as one that dies does: its connections are lost, not closed. */
const stopDataService = async () => {
    if (!server) return

    const stopped = server

    server = undefined

    // Closed below socket.io, or the client would take it for the data service closing the socket, and not try again
    for (const socket of app.io.sockets.sockets.values()) {
        socket.conn.close()
    }

    await app.teardown()
    stopped.close()
    stopped.closeAllConnections()
}

const connectionWith = (options: Partial<ConstructorParameters<typeof FeathersConnection>[0]> = {}) => {
    const connection = new FeathersConnection({ url, ...options })

    connections.push(connection)

    return connection
}

/** What became of a promise so far: a test acts before it settles, and asserts afterwards. */
const outcomeOf = (promise: Promise<unknown>) => {
    const outcome: { state: 'pending' | 'resolved' | 'rejected'; error?: Error } = { state: 'pending' }

    promise.then(
        () => (outcome.state = 'resolved'),
        error => Object.assign(outcome, { state: 'rejected', error }),
    )

    return outcome
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Waits until the condition holds, for no longer than ten seconds. */
const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 10_000

    while (!condition()) {
        if (Date.now() > deadline) throw new Error('The condition did not come to hold')

        await sleep(10)
    }
}

beforeEach(async () => {
    port = await freePort()
    url = `http://localhost:${port}`
})

afterEach(async () => {
    for (const connection of connections.splice(0)) {
        await connection.disconnect()
    }

    await stopDataService()
})

describe('connect() with keepTrying', () => {
    test(
        'resolves once the data service is there, however many attempts fail first',
        async () => {
            const connection = connectionWith({ keepTrying: true, connectTimeout: 100 })
            const errors: Error[] = []
            connection.onConnectError(error => errors.push(error))

            const connecting = connection.connect()
            const outcome = outcomeOf(connecting)

            // The first attempt, and socket.io's second about a second later
            await until(() => errors.length >= 2)

            expect(outcome.state).toBe('pending')
            expect(connection.isConnected).toBe(false)

            await startDataService()
            await connecting

            expect(connection.isConnected).toBe(true)
            expect(errors[0]?.message).toStartWith(`Could not connect to the data service at ${url}: `)
            expect(errors[0]?.cause).toBeInstanceOf(Error)

            const heard = errors.length

            await sleep(1600)

            expect(errors.length).toBe(heard)
        },
        SLOW,
    )

    test('disconnect() while it tries rejects it, and nothing tries on', async () => {
        const connection = connectionWith({ keepTrying: true })
        let attempts = 0
        connection.onConnectError(() => attempts++)

        const outcome = outcomeOf(connection.connect())

        await until(() => attempts >= 1)
        await connection.disconnect()
        await sleep(0)

        expect(outcome.state).toBe('rejected')
        expect(outcome.error?.message).toBe(`Could not connect to the data service at ${url}: disconnect() was called`)

        const heard = attempts

        // Longer than socket.io's longest wait before a second attempt
        await sleep(1600)

        expect(attempts).toBe(heard)

        await startDataService()
        await sleep(200)

        expect(connection.isConnected).toBe(false)
    })

    test('it can connect again after a disconnect() that ended the trying', async () => {
        const connection = connectionWith({ keepTrying: true })
        const outcome = outcomeOf(connection.connect())

        await connection.disconnect()
        await sleep(0)

        expect(outcome.state).toBe('rejected')

        await startDataService()
        await connection.connect()

        expect(connection.isConnected).toBe(true)
    })

    test('every connect() that is trying resolves at the one connection', async () => {
        const connection = connectionWith({ keepTrying: true })
        let connected = 0
        connection.onConnected(() => connected++)

        const both = Promise.all([connection.connect(), connection.connect()])

        await startDataService()
        await both

        expect(connected).toBe(1)
    })

    test('rejects when the data service refuses the connection, which socket.io does not try again', async () => {
        await startDataService({ isRefusing: true })

        const connection = connectionWith({ keepTrying: true })
        let attempts = 0
        connection.onConnectError(() => attempts++)

        const outcome = outcomeOf(connection.connect())

        await until(() => outcome.state !== 'pending')

        expect(outcome.state).toBe('rejected')
        expect(outcome.error?.message).toBe(`Could not connect to the data service at ${url}: Not welcome`)
        expect(attempts).toBe(1)

        await sleep(1600)

        expect(attempts).toBe(1)
    })

    test(
        'a connection that was logged in logs in again once the data service is there',
        async () => {
            await startDataService()

            const connection = connectionWith({ keepTrying: true })

            await connection.connect()
            await connection.authenticate(LOGIN)
            await connection.disconnect()
            await stopDataService()

            let attempts = 0
            connection.onConnectError(() => attempts++)

            const connecting = connection.connect()
            // A call made while it tries waits for the connection and the login
            const created = connection.service('items').create({ id: 'a', name: 'A' })

            await until(() => attempts >= 1)

            expect(connection.isAuthenticated).toBe(false)

            await startDataService()
            await connecting

            expect(await created).toEqual({ id: 'a', name: 'A' })
            expect(connection.isAuthenticated).toBe(true)
        },
        SLOW,
    )

    test(
        'disconnect() while a logged-in connection tries keeps the login for the next connect()',
        async () => {
            await startDataService()

            const connection = connectionWith({ keepTrying: true })

            await connection.connect()
            await connection.authenticate(LOGIN)
            await connection.disconnect()
            await stopDataService()

            const outcome = outcomeOf(connection.connect())

            await connection.disconnect()
            await sleep(0)

            expect(outcome.state).toBe('rejected')

            await startDataService()

            const authenticated = new Promise<void>(resolve => connection.onAuthenticated(resolve))

            await connection.connect()
            await authenticated

            expect(connection.isAuthenticated).toBe(true)
        },
        SLOW,
    )
})

describe('connect() without keepTrying', () => {
    test('rejects on the first attempt that fails, which onConnectError hears, and stops trying', async () => {
        const connection = connectionWith()
        const errors: Error[] = []
        connection.onConnectError(error => errors.push(error))

        const outcome = outcomeOf(connection.connect())

        await until(() => outcome.state !== 'pending')

        expect(outcome.state).toBe('rejected')
        expect(errors.length).toBe(1)
        expect(errors[0]?.message).toBe(outcome.error?.message as string)

        await sleep(1600)

        expect(errors.length).toBe(1)
    })

    test('disconnect() before it settles rejects it', async () => {
        await startDataService()

        const connection = connectionWith()
        const outcome = outcomeOf(connection.connect())

        await connection.disconnect()
        await sleep(0)

        expect(outcome.state).toBe('rejected')
        expect(outcome.error?.message).toBe(`Could not connect to the data service at ${url}: disconnect() was called`)
        expect(connection.isConnected).toBe(false)
    })
})

describe('onConnectError', () => {
    test(
        "hears socket.io's attempts to bring a lost connection back, until unsubscribed",
        async () => {
            await startDataService()

            const connection = connectionWith()
            let attempts = 0
            let others = 0
            connection.onConnectError(() => attempts++)
            const unsubscribe = connection.onConnectError(() => others++)

            await connection.connect()

            expect(attempts).toBe(0)

            unsubscribe()
            await stopDataService()
            await until(() => attempts >= 1)

            const reconnected = new Promise<void>(resolve => connection.onReconnected(resolve))

            await startDataService()
            await reconnected

            expect(connection.isConnected).toBe(true)
            expect(others).toBe(0)
        },
        SLOW,
    )
})
