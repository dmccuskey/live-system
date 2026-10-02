// The data service's Feathers app: a service per kind of record, over Socket.IO.
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { feathers, type Application, type HookContext } from '@feathersjs/feathers'
import socketio from '@feathersjs/socketio'
// For the types of `channel` and `publish`
import '@feathersjs/transport-commons'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/record'
import { SqliteService } from './sqlite-service.ts'

export interface DataServiceOptions {
    /** The port to listen on. With 0 the system picks a free one. */
    port: number
    /** The SQLite file, created with its folder when missing, or `:memory:`. */
    filename: string
}

export interface DataService {
    /** Opens the database and listens. Resolves with the port it listens on. */
    start(): Promise<number>
    /** Stops listening, drops every connection and closes the database. */
    stop(): Promise<void>
}

interface ServiceTypes {
    users: SqliteService<UserRecord>
    servers: SqliteService<ServerRecord>
}

/** A record without an ID gets one here, so IDs are strings whatever creates the record. */
const assignId = async (context: HookContext) => {
    context.data.id ??= crypto.randomUUID()
}

export function createDataService(options: DataServiceOptions): DataService {
    let running: { app: Application<ServiceTypes>; db: Database } | undefined

    return {
        async start() {
            if (running) throw new Error('The data service is already started')

            if (options.filename !== ':memory:') mkdirSync(dirname(options.filename), { recursive: true })

            const db = new Database(options.filename, { create: true })
            const app = feathers<ServiceTypes>()

            app.configure(socketio())
            app.use(SERVICES.users, new SqliteService<UserRecord>(db, SERVICES.users))
            app.use(SERVICES.servers, new SqliteService<ServerRecord>(db, SERVICES.servers))

            for (const path of [SERVICES.users, SERVICES.servers]) {
                app.service(path).hooks({ before: { create: [assignId] } })
            }

            // Without a channel no client hears an event: every client hears every change
            app.on('connection', peer => app.channel('everyone').join(peer))
            app.publish(() => app.channel('everyone'))

            const server = (await app.listen(options.port)) as Server

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
