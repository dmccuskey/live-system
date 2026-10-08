// The data service's Feathers app: a service per kind of record, over Socket.IO.
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { Forbidden } from '@feathersjs/errors'
import { feathers, type Application, type HookContext } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio'
// For the types of `channel` and `publish`
import '@feathersjs/transport-commons'
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { SqliteService } from './sqlite-service.ts'

export interface DataServiceOptions {
    /** The port to listen on. With 0 the system picks a free one. */
    port: number
    /** The SQLite file, created with its folder when missing, or `:memory:`. */
    filename: string
    /**
     * With it the records are read-only from outside: a client may write only if it sent
     * the same token as `writeToken` in its handshake. Every client may write unless given.
     */
    writeToken?: string
}

export interface DataService {
    /**
     * Opens the database and listens. Resolves with the port it listens on: the records
     * over Socket.IO, and a GET to `/health` says whether the database answers.
     */
    start(): Promise<number>
    /** Stops listening, drops every connection and closes the database. */
    stop(): Promise<void>
}

interface ServiceTypes {
    users: SqliteService<UserRecord>
    servers: SqliteService<ServerRecord>
    managers: SqliteService<ManagerRecord>
}

/** A record without an ID gets one here, so IDs are strings whatever creates the record. */
const assignId = async (context: HookContext) => {
    context.data.id ??= crypto.randomUUID()
}

const isSame = (given: unknown, expected: string) => {
    if (typeof given !== 'string') return false

    const a = Buffer.from(given)
    const b = Buffer.from(expected)

    return a.length === b.length && timingSafeEqual(a, b)
}

/** Refuses a write from a client that did not send the write token. A call made in this process has no provider. */
const refuseOutsideWrite = async (context: HookContext) => {
    if (context.params.provider && !context.params.mayWrite) {
        throw new Forbidden('The records are read-only')
    }
}

/** Socket.IO's own path: its requests are answered by Socket.IO, on the same HTTP server. */
const SOCKET_PATH = '/socket.io/'
const HEALTH_PATH = '/health'

/** Answers what Socket.IO leaves alone: the health address, and 404 for anything else. */
const answerHttp = (db: Database) => (request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? ''

    if (url.startsWith(SOCKET_PATH)) return

    const json = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify(body))
    }

    if (request.method !== 'GET' || url.split('?')[0] !== HEALTH_PATH) return json(404, { status: 'not_found' })

    try {
        db.query('SELECT 1').get()
        json(200, { status: 'ok' })
    } catch {
        json(503, { status: 'unavailable' })
    }
}

export function createDataService(options: DataServiceOptions): DataService {
    let running: { app: Application<ServiceTypes>; db: Database } | undefined

    return {
        async start() {
            if (running) throw new Error('The data service is already started')

            if (options.filename !== ':memory:') mkdirSync(dirname(options.filename), { recursive: true })

            const db = new Database(options.filename, { create: true })
            const app = feathers<ServiceTypes>()

            const { writeToken } = options

            app.configure(
                socketio(io => {
                    // Decided once, as the client connects, and kept with the connection:
                    // Feathers hands `socket.feathers` to every call as its params
                    io.use((socket, next) => {
                        const params = (socket as typeof socket & { feathers: Record<string, unknown> }).feathers

                        params.mayWrite =
                            writeToken === undefined || isSame(socket.handshake.auth.writeToken, writeToken)
                        next()
                    })
                }),
            )
            app.use(SERVICES.users, new SqliteService<UserRecord>(db, SERVICES.users))
            app.use(SERVICES.servers, new SqliteService<ServerRecord>(db, SERVICES.servers))
            app.use(SERVICES.managers, new SqliteService<ManagerRecord>(db, SERVICES.managers))

            for (const path of Object.values(SERVICES)) {
                app.service(path).hooks({
                    before: {
                        create: [refuseOutsideWrite, assignId],
                        update: [refuseOutsideWrite],
                        patch: [refuseOutsideWrite],
                        remove: [refuseOutsideWrite],
                    },
                })
            }

            // Without a channel no client hears an event: every client hears every change
            app.on('connection', peer => app.channel('everyone').join(peer))
            app.publish(() => app.channel('everyone'))

            const server = (await app.listen(options.port)) as Server

            server.on('request', answerHttp(db))

            running = { app, db }

            return (server.address() as AddressInfo).port
        },

        async stop() {
            if (!running) return

            const { app, db } = running

            running = undefined
            await app.teardown()
            // teardown() leaves the HTTP server listening and the clients connected:
            // closing Socket.IO drops the clients and closes the HTTP server with them
            await app.io.close()
            db.close()
        },
    }
}
