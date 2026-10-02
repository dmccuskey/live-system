// The live server's composition: the connection, the router, the managers and the command server.
import type { DemoEvents } from '@virtual-infrastructure/protocol/events'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { FeathersConnection } from 'feathers-connect'
import { EventBus, LiveSystem } from 'live-system/core'
import { CommandServer, Router } from 'live-system/server'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'
import { ServerManager } from './server-manager.ts'
import { SettingsManager } from './settings-manager.ts'
import { StatusManager } from './status-manager.ts'
import { useServerStore, useSettingsStore, useStatusStore, useUserStore } from './stores.ts'
import { UserManager } from './user-manager.ts'

export interface LiveServerOptions {
    /** The data service's address, for example `http://localhost:3030`. */
    dataServiceUrl: string
    /** The port to take commands on. With 0 the system picks a free one. */
    port: number
    /** `Math.random`, unless given. */
    random?: () => number
    /** Multiplies every duration and delay. 1, unless given. */
    timeScale?: number
}

export interface LiveServer {
    /** Connects to the data service, boots the system and listens. Resolves with the port it listens on. */
    start(): Promise<number>
    /** Stops listening, stops the managers and closes the connection. */
    stop(): Promise<void>
    /** The system's events, for whoever runs the live server to watch. */
    readonly events: EventBus<DemoEvents>
}

export function createLiveServer(options: LiveServerOptions): LiveServer {
    const events = new EventBus<DemoEvents>()
    let running: { system: LiveSystem<DemoContext>; commandServer: CommandServer } | undefined

    return {
        events,

        async start() {
            if (running) throw new Error('The live server is already started')

            const connection = new FeathersConnection({ url: options.dataServiceUrl })
            const router = new Router()
            const pinia = createPinia()

            const system = new LiveSystem<DemoContext>({
                context: {
                    events,
                    pinia,
                    random: options.random ?? Math.random,
                    timeScale: options.timeScale ?? 1,
                },
                router,
                connect: () => connection.connect(),
                disconnect: () => connection.disconnect(),
            })

            system.addManager(
                context => new StatusManager(context, connection.recordSource(SERVICES.status), useStatusStore(pinia)),
            )
            // In any order: each loads its store in init(), begins to watch in start(), and acts in run()
            system.addManager(
                context => new ServerManager(context, connection.recordSource(SERVICES.servers), useServerStore(pinia)),
            )
            system.addManager(
                context =>
                    new SettingsManager(context, connection.recordSource(SERVICES.settings), useSettingsStore(pinia)),
            )
            system.addManager(
                context => new UserManager(context, connection.recordSource(SERVICES.users), useUserStore(pinia)),
            )

            const commandServer = new CommandServer({ router })

            running = { system, commandServer }

            try {
                await system.boot()
                commandServer.listen({ port: options.port })
            } catch (error) {
                running = undefined
                await system.shutdown().catch(() => {})
                throw error
            }

            return commandServer.port as number
        },

        async stop() {
            if (!running) return

            const { system, commandServer } = running

            running = undefined
            await commandServer.close()
            await system.shutdown()
        },
    }
}
