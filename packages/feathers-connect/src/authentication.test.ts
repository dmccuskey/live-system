// Logging in through the connection, against a real Feathers app with authentication in this process.
import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthenticationService, JWTStrategy, authenticate } from '@feathersjs/authentication'
import { LocalStrategy, hooks as localHooks } from '@feathersjs/authentication-local'
import { GeneralError, NotAuthenticated } from '@feathersjs/errors'
import { feathers, type HookContext } from '@feathersjs/feathers'
import { MemoryService } from '@feathersjs/memory'
import socketio from '@feathersjs/socketio'
import { FeathersConnection } from './connection.ts'

interface Item {
    id: string
    name: string
}

const LOGIN = { strategy: 'local', email: 'ada@example.com', password: 'secret' }

let app: any
let server: Server
let url: string
const connections: FeathersConnection[] = []

/** What a test switches on to make the data service fail. */
const faults = { login: false, items: false }

/**
 * A data service with a login: `users` to log in as, `items` for those logged
 * in, who alone hear its changes, and `notes` for anyone.
 */
const startDataService = async ({ expiresIn = '1d', path = 'authentication' } = {}) => {
    app = feathers()

    app.configure(socketio())
    app.set('authentication', {
        secret: 'a test secret',
        entity: 'user',
        service: 'users',
        authStrategies: ['jwt', 'local'],
        jwtOptions: { header: { typ: 'access' }, audience: 'https://example.com', algorithm: 'HS256', expiresIn },
        local: { usernameField: 'email', passwordField: 'password' },
    })

    const authentication = new AuthenticationService(app)
    authentication.register('jwt', new JWTStrategy())
    authentication.register('local', new LocalStrategy())
    app.use(path, authentication)
    app.service(path).hooks({
        before: {
            create: [
                async () => {
                    if (faults.login) throw new GeneralError('The login is out of order')
                },
            ],
        },
    })

    app.use('users', new MemoryService({ id: 'id' }))
    app.service('users').hooks({ before: { create: [localHooks.hashPassword('password')] } })

    app.use('items', new MemoryService({ id: 'id' }))
    app.service('items').hooks({
        before: {
            all: [
                authenticate('jwt'),
                async () => {
                    if (faults.items) throw new NotAuthenticated('Refused by the service')
                },
            ],
        },
    })
    app.use('notes', new MemoryService({ id: 'id' }))

    app.on('login', (_result: unknown, { connection }: { connection?: unknown }) => {
        if (connection) app.channel('authenticated').join(connection)
    })
    app.service('items').publish(() => app.channel('authenticated'))

    await app.service('users').create({ id: 'ada', email: LOGIN.email, password: LOGIN.password })

    server = (await app.listen(0)) as Server
    url = `http://localhost:${(server.address() as AddressInfo).port}`
}

/** A connection that is closed at the end of the test. */
const connectionTo = (options: { requestTimeout?: number; authentication?: { path?: string } } = {}) => {
    const connection = new FeathersConnection({ url, ...options })

    connections.push(connection)

    return connection
}

/** Loses the only connection as a data service that dies does. Resolves once it is lost. */
const lose = async (connection: FeathersConnection) => {
    const [serverSocket] = [...app.io.sockets.sockets.values()]
    const isLost = new Promise<void>(resolve => connection.onDisconnected(resolve))

    serverSocket.conn.close()
    await isLost
}

/** What a connection's listeners are called with, in order. */
const listenTo = (connection: FeathersConnection) => {
    const heard: string[] = []

    connection.onConnected(() => heard.push('connected'))
    connection.onDisconnected(() => heard.push('disconnected'))
    connection.onReconnected(() => heard.push('reconnected'))
    connection.onAuthenticated(() => heard.push('authenticated'))
    connection.onAuthenticationLost(error => heard.push(`lost: ${error.message}`))

    return heard
}

/** Resolves the next time the listener is called. */
const next = (subscribe: (listener: () => void) => unknown) => new Promise<void>(resolve => subscribe(resolve))

/** How a call ends: its answer, or its error's message. */
const outcomeOf = (call: Promise<unknown>) =>
    call.then(
        answer => answer,
        (error: Error) => error.message,
    )

afterEach(async () => {
    for (const connection of connections.splice(0)) {
        await connection.disconnect()
    }

    faults.login = false
    faults.items = false
    await app.teardown()
    // teardown() leaves the HTTP server listening
    server.close()
})

describe('logging in', () => {
    test('authenticate() with the local strategy logs in, and the services answer', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()

        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toBeUndefined()
        expect(await outcomeOf(items.find())).toBe('Not authenticated')

        const answer = await connection.authenticate(LOGIN)

        expect(answer.accessToken).toBeString()
        expect(connection.isAuthenticated).toBe(true)
        expect(connection.user).toMatchObject({ id: 'ada', email: LOGIN.email })
        expect(await items.create({ id: 'a', name: 'A' })).toEqual({ id: 'a', name: 'A' })
        expect(heard).toEqual(['connected', 'authenticated'])
    })

    test('authenticate() with a token as the first login takes the user from the answer', async () => {
        await startDataService()
        const { accessToken } = await app.service('authentication').create(LOGIN)
        const connection = connectionTo()
        await connection.connect()

        await connection.authenticate({ strategy: 'jwt', accessToken })

        expect(connection.isAuthenticated).toBe(true)
        expect(connection.user).toMatchObject({ id: 'ada', email: LOGIN.email })
        expect(await connection.recordSource<Item>('items').find()).toEqual([])
    })

    test('authenticate() made before connect() is sent as the connection is made', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)

        const login = connection.authenticate(LOGIN)
        const found = connection.recordSource<Item>('items').find()
        await connection.connect()
        await login

        // The call made while the login was under way waited for it
        expect(await found).toEqual([])
        expect(heard).toEqual(['connected', 'authenticated'])
    })

    test('a refused authenticate() rejects with the error, and nothing is lost', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()

        const error = await connection.authenticate({ ...LOGIN, password: 'wrong' }).catch(error => error)

        expect(error).toMatchObject({ name: 'NotAuthenticated', code: 401 })
        expect(connection.isAuthenticated).toBe(false)
        expect(heard).toEqual(['connected'])
    })

    test('a refused authenticate() leaves an earlier login as it is', async () => {
        await startDataService()
        const connection = connectionTo()
        await connection.connect()
        await connection.authenticate(LOGIN)

        await connection.authenticate({ ...LOGIN, password: 'wrong' }).catch(() => {})

        expect(connection.isAuthenticated).toBe(true)
        expect(await connection.recordSource<Item>('items').find()).toEqual([])
    })

    test('logout() ends the login, here and at the data service', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        await connection.logout()

        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toBeUndefined()
        expect(await outcomeOf(items.find())).toBe('Not authenticated')
        // A call refused after a logout is no lost login
        expect(heard).toEqual(['connected', 'authenticated'])
    })

    test('after logout() the connection does not log in again when it is made anew', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate(LOGIN)
        await connection.logout()

        await connection.disconnect()
        await connection.connect()

        expect(connection.isAuthenticated).toBe(false)
        expect(heard).toEqual(['connected', 'authenticated', 'disconnected', 'connected', 'reconnected'])
    })

    test('logout() without a login does nothing', async () => {
        await startDataService()
        const connection = connectionTo()
        await connection.connect()

        await connection.logout()

        expect(connection.isAuthenticated).toBe(false)
    })
})

describe('a data service with its authentication at another path', () => {
    test('logs in, logs in again and logs out there, with or without slashes around the path', async () => {
        await startDataService({ path: 'auth' })
        const connection = connectionTo({ authentication: { path: '/auth/' } })
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        const reconnected = next(listener => connection.onReconnected(listener))
        await lose(connection)

        // Waits for the login, which itself is not held
        expect(await items.find()).toEqual([])
        await reconnected

        expect(heard).toEqual([
            'connected',
            'authenticated',
            'disconnected',
            'connected',
            'authenticated',
            'reconnected',
        ])

        await connection.logout()

        expect(await outcomeOf(items.find())).toBe('Not authenticated')
    })

    test('a login sent to the default path is not found', async () => {
        await startDataService({ path: 'auth' })
        const connection = connectionTo()
        await connection.connect()

        const error = await connection.authenticate(LOGIN).catch(error => error)

        expect(error).toMatchObject({ name: 'NotFound', code: 404 })
        expect(connection.isAuthenticated).toBe(false)
    })
})

describe('a connection that never logs in', () => {
    test('calls an open service, and hears onReconnected as before', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const notes = connection.recordSource<Item>('notes')
        await connection.connect()
        await notes.create({ id: 'a', name: 'A' })

        const reconnected = next(listener => connection.onReconnected(listener))
        await lose(connection)

        // Held by socket.io until the connection is back, as without a login
        expect(await notes.patch('a', { name: 'held' })).toEqual({ id: 'a', name: 'held' })
        await reconnected

        expect(heard).toEqual(['connected', 'disconnected', 'connected', 'reconnected'])
    })
})

describe('logging in again', () => {
    test('after a lost connection comes back: logged in first, then onReconnected, and changes are heard again', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        const reconnected = next(listener => connection.onReconnected(listener))
        await lose(connection)

        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toMatchObject({ id: 'ada' })

        await reconnected

        expect(connection.isAuthenticated).toBe(true)
        expect(heard).toEqual([
            'connected',
            'authenticated',
            'disconnected',
            'connected',
            'authenticated',
            'reconnected',
        ])

        // The new socket is in the data service's channel again
        const created = new Promise<Item>(resolve => items.onCreated(resolve))
        await app.service('items').create({ id: 'a', name: 'A' })

        expect(await created).toEqual({ id: 'a', name: 'A' })
    })

    test('a call made during an outage shorter than requestTimeout waits for the login, and is answered', async () => {
        await startDataService()
        const connection = connectionTo()
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)
        await lose(connection)

        expect(await items.create({ id: 'a', name: 'A' })).toEqual({ id: 'a', name: 'A' })
        expect(connection.isAuthenticated).toBe(true)
    })

    test('a call made during an outage longer than requestTimeout rejects and is not sent later; the login comes back all the same', async () => {
        await startDataService()
        const connection = connectionTo({ requestTimeout: 200 })
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        const reconnected = next(listener => connection.onReconnected(listener))
        await lose(connection)

        expect(await outcomeOf(items.create({ id: 'a', name: 'late' }))).toBe('operation has timed out')

        // socket.io brings the connection back by itself, after about a second: long after the timeout
        await reconnected

        expect(connection.isAuthenticated).toBe(true)
        expect(await items.find()).toEqual([])
        expect(heard).toEqual([
            'connected',
            'authenticated',
            'disconnected',
            'connected',
            'authenticated',
            'reconnected',
        ])
    })

    test('connect() after disconnect() logs in again, then calls onReconnected', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)
        await connection.disconnect()

        const reconnected = next(listener => connection.onReconnected(listener))
        const found = items.find()
        await connection.connect()

        // connect() resolves at the socket's connect, before the login
        expect(connection.isAuthenticated).toBe(false)
        expect(await found).toEqual([])

        await reconnected

        expect(connection.isAuthenticated).toBe(true)
        expect(heard).toEqual([
            'connected',
            'authenticated',
            'disconnected',
            'connected',
            'authenticated',
            'reconnected',
        ])
    })
})

describe('a login that is lost', () => {
    test('a refusal to log in again: onAuthenticationLost, and onReconnected held back until authenticate() succeeds', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        // The data service no longer accepts the token
        app.get('authentication').secret = 'another secret'
        const lost = new Promise<Error>(resolve => connection.onAuthenticationLost(resolve))
        await lose(connection)

        expect(await lost).toMatchObject({ name: 'NotAuthenticated', code: 401 })
        expect(connection.isConnected).toBe(true)
        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toBeUndefined()
        // Calls are held no longer: the data service refuses them
        expect(await outcomeOf(items.find())).toBe('Not authenticated')
        expect(heard.slice(2)).toEqual(['disconnected', 'connected', expect.stringMatching(/^lost: /)])

        await connection.authenticate(LOGIN)

        expect(heard.slice(5)).toEqual(['authenticated', 'reconnected'])
        expect(await items.find()).toEqual([])
    })

    test('a lost login stays lost when the connection is made anew, and onReconnected is called once', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate(LOGIN)
        app.get('authentication').secret = 'another secret'
        const lost = next(listener => connection.onAuthenticationLost(listener))
        await lose(connection)
        await lost

        await connection.disconnect()
        await connection.connect()

        expect(heard.slice(5)).toEqual(['disconnected', 'connected'])

        await connection.authenticate(LOGIN)

        expect(heard.slice(7)).toEqual(['authenticated', 'reconnected'])
    })

    test('a token that runs out while connected: onAuthenticationLost, and onReconnected after the next authenticate()', async () => {
        await startDataService({ expiresIn: '1s' })
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate(LOGIN)

        const lost = await new Promise<Error>(resolve => connection.onAuthenticationLost(resolve))

        expect(lost).toMatchObject({ name: 'NotAuthenticated', code: 401 })
        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toBeUndefined()

        // The data service closed the socket, the connection came back by itself and its token was refused
        expect(lost.message).toBe('jwt expired')
        expect(connection.isConnected).toBe(true)
        expect(heard).toEqual(['connected', 'authenticated', 'disconnected', 'connected', 'lost: jwt expired'])

        await connection.authenticate(LOGIN)

        expect(heard.slice(5)).toEqual(['authenticated', 'reconnected'])
        expect(await connection.recordSource<Item>('items').find()).toEqual([])
    })

    test('a token given as the first login runs out by its own expiry', async () => {
        await startDataService({ expiresIn: '1s' })
        const { accessToken } = await app.service('authentication').create(LOGIN)
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate({ strategy: 'jwt', accessToken })

        const lost = await new Promise<Error>(resolve => connection.onAuthenticationLost(resolve))

        expect(lost).toMatchObject({ name: 'NotAuthenticated', code: 401 })
        expect(connection.isAuthenticated).toBe(false)
        expect(heard.slice(0, 2)).toEqual(['connected', 'authenticated'])
    })

    test('a call refused as not authenticated: the call rejects, and the login is lost', async () => {
        await startDataService()
        const connection = connectionTo()
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        faults.items = true

        expect(await outcomeOf(items.find())).toBe('Refused by the service')
        expect(connection.isAuthenticated).toBe(false)
        expect(heard).toEqual(['connected', 'authenticated', 'lost: Refused by the service'])

        // Refused again: lost only once
        await outcomeOf(items.find())

        expect(heard).toHaveLength(3)

        faults.items = false
        await connection.authenticate(LOGIN)

        expect(heard.slice(3)).toEqual(['authenticated', 'reconnected'])
    })

    test('a data service that does not close the socket of a token that has run out: the library reports it, a while after', async () => {
        await startDataService({ expiresIn: '1s' })
        // Takes away what closes the socket at a token's expiry
        app.removeAllListeners('disconnect')
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate(LOGIN)

        await next(listener => connection.onAuthenticationLost(listener))

        expect(connection.isConnected).toBe(true)
        expect(connection.isAuthenticated).toBe(false)
        expect(heard).toEqual(['connected', 'authenticated', 'lost: The access token has expired'])

        await connection.authenticate(LOGIN)

        expect(heard.slice(3)).toEqual(['authenticated', 'reconnected'])
    })

    test('after logout() no timer reports the token as run out', async () => {
        await startDataService({ expiresIn: '1s' })
        const connection = connectionTo()
        const heard = listenTo(connection)
        await connection.connect()
        await connection.authenticate(LOGIN)
        await connection.logout()

        await Bun.sleep(3100)

        expect(heard).toEqual(['connected', 'authenticated'])
    })
})

describe('a login that fails without a refusal', () => {
    test('nothing is called, calls wait, and it is tried again the next time the connection is made', async () => {
        await startDataService()
        const connection = connectionTo({ requestTimeout: 200 })
        const heard = listenTo(connection)
        const items = connection.recordSource<Item>('items')
        await connection.connect()
        await connection.authenticate(LOGIN)

        faults.login = true
        let connected = next(listener => connection.onConnected(listener))
        await lose(connection)
        await connected
        // Time for the login to be answered
        await Bun.sleep(100)

        expect(connection.isAuthenticated).toBe(false)
        expect(connection.user).toMatchObject({ id: 'ada' })
        expect(heard.slice(2)).toEqual(['disconnected', 'connected'])
        expect(await outcomeOf(items.find())).toBe('operation has timed out')

        faults.login = false
        const reconnected = next(listener => connection.onReconnected(listener))
        await lose(connection)
        await reconnected

        expect(connection.isAuthenticated).toBe(true)
        expect(heard.slice(4)).toEqual(['disconnected', 'connected', 'authenticated', 'reconnected'])
        expect(await items.find()).toEqual([])
    })
})
