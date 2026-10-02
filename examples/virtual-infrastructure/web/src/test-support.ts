// What the web app's tests share: a web app without a connection, records, and waiting.
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import type { Command, CommandResponse } from 'live-system/core'
import { CommandClient } from 'live-system/web'
import type { SystemPhase } from 'live-system/web'
import { createPinia } from 'pinia'
import { ref, shallowReactive } from 'vue'
import { WEB_APP } from './app.ts'
import type { WebApp } from './app.ts'
import { createCommandSender } from './command-sender.ts'

/**
 * A web app for a component to render from, with nothing behind it: the test
 * sets the status and loads the stores, and reads the commands the component sent.
 */
export function createTestApp(respond: (command: Command) => CommandResponse = () => ({ status: 'accepted' })) {
    const sent: Command[] = []
    const status = shallowReactive<{ phase: SystemPhase; error: unknown }>({ phase: 'running', error: undefined })
    const isConnected = ref(true)
    const pinia = createPinia()

    const client = new CommandClient({
        url: 'http://test/command',
        fetch: async (_url, init) => {
            const command = JSON.parse(init.body as string) as Command

            sent.push(command)

            return Response.json(respond(command))
        },
    })

    const app: WebApp = {
        pinia,
        status,
        isConnected,
        commands: createCommandSender(client),
        start: async () => {},
        stop: async () => {},
    }

    return {
        app,
        pinia,
        status,
        isConnected,
        /** Every command sent, in order. */
        sent,
        /** The `global` option of `mount()`. */
        global: { plugins: [pinia], provide: { [WEB_APP as symbol]: app } },
    }
}

export function userRecord(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
        id: 'u1',
        name: 'Alice',
        commandsPerMinute: 8,
        commandMix: { search: 0.7, standard: 0.2, agentic: 0.1 },
        frustration: 0.14,
        ...overrides,
    }
}

export function serverRecord(overrides: Partial<ServerRecord> = {}): ServerRecord {
    return { id: 's1', name: 'Server 1', capacity: 10, load: 4, activeCommands: 2, isDraining: false, ...overrides }
}

/** Resolves once the condition holds. Rejects when it still does not after the timeout. */
export async function until(condition: () => boolean, timeout = 2_000): Promise<void> {
    const end = Date.now() + timeout

    while (!condition()) {
        if (Date.now() > end) throw new Error('The condition was not met in time')

        await new Promise(resolve => setTimeout(resolve, 5))
    }
}
