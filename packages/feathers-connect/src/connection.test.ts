// The connection and a record source against a real Feathers app in this process.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { feathers, type HookContext } from '@feathersjs/feathers'
import { MemoryService } from '@feathersjs/memory'
import socketio from '@feathersjs/socketio'
import { FeathersConnection } from './connection.ts'

interface Item {
    id: string
    name: string
}

let server: Server
let url: string
let connection: FeathersConnection

/** A data service with one service, `items`, that creates string IDs and publishes every change. */
const startDataService = async () => {
    const app = feathers()

    app.configure(socketio())
    app.use('items', new MemoryService({ id: 'id' }))
    app.service('items').hooks({
        before: {
            create: [
                async (context: HookContext) => {
                    context.data.id ??= crypto.randomUUID()
                }
            ]
        }
    })
    app.on('connection', (peer: any) => (app as any).channel('everyone').join(peer))
    ;(app as any).publish(() => (app as any).channel('everyone'))

    server = (await app.listen(0)) as Server
    url = `http://localhost:${(server.address() as AddressInfo).port}`

    return app
}

/** Resolves with the next record the subscription hears. */
const next = <T>(subscribe: (listener: (record: T) => void) => unknown) => new Promise<T>(resolve => subscribe(resolve))

let app: Awaited<ReturnType<typeof startDataService>>

beforeEach(async () => {
    app = await startDataService()
    connection = new FeathersConnection({ url })
})

afterEach(async () => {
    await connection.disconnect()
    await app.teardown()
    // teardown() leaves the HTTP server listening
    server.close()
})

describe('FeathersConnection', () => {
    test('is not connected until connect() resolves', async () => {
        expect(connection.isConnected).toBe(false)

        await connection.connect()

        expect(connection.isConnected).toBe(true)
        expect(connection.url).toBe(url)
    })

    test('connect() on a connected connection resolves', async () => {
        await connection.connect()
        await connection.connect()

        expect(connection.isConnected).toBe(true)
    })

    test('connect() rejects when there is no data service', async () => {
        const nowhere = new FeathersConnection({ url: 'http://localhost:1', connectTimeout: 1000 })

        expect(nowhere.connect()).rejects.toThrow('Could not connect to the data service at http://localhost:1')
        expect(nowhere.isConnected).toBe(false)
    })

    test('disconnect() ends the connection, and it can connect again', async () => {
        await connection.connect()
        await connection.disconnect()

        expect(connection.isConnected).toBe(false)

        await connection.connect()

        expect(connection.isConnected).toBe(true)
    })

    test('listeners hear each connect and disconnect, until unsubscribed', async () => {
        const heard: string[] = []
        const offConnected = connection.onConnected(() => heard.push('connected'))
        connection.onDisconnected(() => heard.push('disconnected'))

        await connection.connect()
        await connection.disconnect()
        offConnected()
        await connection.connect()
        await connection.disconnect()

        expect(heard).toEqual(['connected', 'disconnected', 'disconnected'])
    })

    test('service() gives the Feathers service', async () => {
        await connection.connect()
        await connection.service('items').create({ id: 'a', name: 'A' })

        expect(await connection.service('items').get('a')).toEqual({ id: 'a', name: 'A' })
    })
})

describe('a record source over the connection', () => {
    test('creates, reads, changes and removes records', async () => {
        const source = connection.recordSource<Item>('items')
        await connection.connect()

        const created = await source.create({ name: 'A' })

        expect(created.name).toBe('A')
        expect(typeof created.id).toBe('string')

        expect(await source.create({ id: 'b', name: 'B' })).toEqual({ id: 'b', name: 'B' })
        expect(await source.get('b')).toEqual({ id: 'b', name: 'B' })
        expect(await source.patch('b', { name: 'B2' })).toEqual({ id: 'b', name: 'B2' })
        expect(await source.update('b', { id: 'b', name: 'B3' })).toEqual({ id: 'b', name: 'B3' })
        expect(await source.find()).toEqual([created, { id: 'b', name: 'B3' }])
        expect(await source.remove('b')).toEqual({ id: 'b', name: 'B3' })
        expect(await source.find()).toEqual([created])
    })

    test('find() takes the fixed query', async () => {
        const source = connection.recordSource<Item>('items')
        const onlyA = connection.recordSource<Item>('items', { query: { name: 'A' } })
        await connection.connect()
        await source.create({ id: 'a', name: 'A' })
        await source.create({ id: 'b', name: 'B' })

        expect(await onlyA.find()).toEqual([{ id: 'a', name: 'A' }])
    })

    test('find() returns the records of a paginated service', async () => {
        app.use('pages', new MemoryService({ id: 'id', paginate: { default: 10, max: 10 } }))
        const source = connection.recordSource<Item>('pages')
        await connection.connect()
        await source.create({ id: 'a', name: 'A' })

        expect(await source.find()).toEqual([{ id: 'a', name: 'A' }])
    })

    test('get() of a missing record rejects with NotFound', async () => {
        const source = connection.recordSource<Item>('items')
        await connection.connect()

        expect(source.get('missing')).rejects.toMatchObject({ name: 'NotFound', code: 404 })
    })

    test('listeners attached before connect() hear changes made by another client', async () => {
        const source = connection.recordSource<Item>('items')
        const created = next<Item>(listener => source.onCreated(listener))
        const patched = next<Item>(listener => source.onPatched(listener))
        const updated = next<Item>(listener => source.onUpdated(listener))
        const removed = next<Item>(listener => source.onRemoved(listener))
        await connection.connect()

        const other = new FeathersConnection({ url })
        const otherSource = other.recordSource<Item>('items')
        await other.connect()

        await otherSource.create({ id: 'a', name: 'A' })
        expect(await created).toEqual({ id: 'a', name: 'A' })

        await otherSource.patch('a', { name: 'A2' })
        expect(await patched).toEqual({ id: 'a', name: 'A2' })

        await otherSource.update('a', { id: 'a', name: 'A3' })
        expect(await updated).toEqual({ id: 'a', name: 'A3' })

        await otherSource.remove('a')
        expect(await removed).toEqual({ id: 'a', name: 'A3' })

        await other.disconnect()
    })

    test('a listener stays attached when the connection is closed and made again', async () => {
        const source = connection.recordSource<Item>('items')
        const heard: Item[] = []
        source.onCreated(record => heard.push(record))
        await connection.connect()
        await connection.disconnect()
        await connection.connect()

        const created = next<Item>(listener => source.onCreated(listener))
        await source.create({ id: 'a', name: 'A' })
        await created

        expect(heard).toEqual([{ id: 'a', name: 'A' }])
    })

    test('an unsubscribed listener hears nothing more', async () => {
        const source = connection.recordSource<Item>('items')
        const heard: Item[] = []
        const unsubscribe = source.onCreated(record => heard.push(record))
        await connection.connect()

        const first = next<Item>(listener => source.onCreated(listener))
        await source.create({ id: 'a', name: 'A' })
        await first
        unsubscribe()

        const second = next<Item>(listener => source.onCreated(listener))
        await source.create({ id: 'b', name: 'B' })
        await second

        expect(heard).toEqual([{ id: 'a', name: 'A' }])
    })
})
