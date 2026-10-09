// The web app's composition: the connection, the managers, the startup and the command sender.
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { FeathersConnection } from 'feathers-connect'
import { LiveSystem } from 'live-system/core'
import { CommandClient, WebStartup } from 'live-system/web'
import type { Fetch, SystemStatus } from 'live-system/web'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { readonly, ref, shallowReadonly, shallowRef } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import { createCommandSender } from './command-sender.ts'
import type { CommandSender } from './command-sender.ts'
import { emptyWebConfig, loadWebConfig } from './config.ts'
import type { WebConfig } from './config.ts'
import type { WebContext } from './context.ts'
import { ManagerRecords, ServerManager, UserManager } from './managers.ts'
import { useManagerStore, useServerStore, useUserStore } from './stores.ts'

export interface WebAppOptions {
    /** The data service's address, for example `http://localhost:3030`. */
    dataServiceUrl: string
    /** Where commands are posted: the live server's `CommandServer`, or a proxy to it. */
    commandUrl: string
    /** Where the run-time configuration is read from, for example `/config.json`. Not read unless given. */
    configUrl?: string
    /** The `fetch` to send commands and read the configuration with. The global one unless given. */
    fetch?: Fetch
}

/** What the components render from and act through. They get it with `useWebApp()`. */
export interface WebApp {
    /** Holds the stores. */
    readonly pinia: Pinia
    /** Where the system stands: starting, running or failed. */
    readonly status: SystemStatus
    /** Whether the data service is connected, after startup as well. */
    readonly isConnected: Readonly<Ref<boolean>>
    readonly commands: CommandSender
    /** The run-time configuration: empty until it has been read, and when there is none. */
    readonly config: Readonly<Ref<WebConfig>>
    /** Connects and loads the stores. A failure is reported in `status`. */
    start(): Promise<void>
    stop(): Promise<void>
}

/** The key the web app is provided to the components under. */
export const WEB_APP: InjectionKey<WebApp> = Symbol('webApp')

export function createWebApp(options: WebAppOptions): WebApp {
    const connection = new FeathersConnection({ url: options.dataServiceUrl })
    const pinia = createPinia()
    const isConnected = ref(false)
    // Replaced whole when read, never changed in place
    const config = shallowRef<WebConfig>(emptyWebConfig())

    const subscriptions = [
        connection.onConnected(() => (isConnected.value = true)),
        connection.onDisconnected(() => (isConnected.value = false)),
    ]

    // No router: a web app takes no commands, it sends them
    const system = new LiveSystem<WebContext>({
        context: { pinia },
        connect: () => connection.connect(),
        disconnect: () => connection.disconnect(),
    })

    system.addManager(context => new UserManager(context, connection.recordSource(SERVICES.users), useUserStore(pinia)))
    system.addManager(
        context => new ServerManager(context, connection.recordSource(SERVICES.servers), useServerStore(pinia)),
    )
    system.addManager(
        context => new ManagerRecords(context, connection.recordSource(SERVICES.managers), useManagerStore(pinia)),
    )

    const startup = new WebStartup(system)
    const commands = createCommandSender(new CommandClient({ url: options.commandUrl, fetch: options.fetch }))

    return {
        pinia,
        status: startup.status,
        isConnected: readonly(isConnected),
        commands,
        config: shallowReadonly(config),

        start() {
            // Beside the startup, which does not wait for it: the page works without
            if (options.configUrl) {
                void loadWebConfig(options.configUrl, options.fetch).then(loaded => (config.value = loaded))
            }

            return startup.start()
        },

        async stop() {
            commands.dismiss()
            await startup.stop()

            for (const unsubscribe of subscriptions.splice(0)) {
                unsubscribe()
            }

            isConnected.value = false
        },
    }
}
