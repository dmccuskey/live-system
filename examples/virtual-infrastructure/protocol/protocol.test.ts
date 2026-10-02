import { expect, test } from 'bun:test'
import { DATA_SERVICE_PORT, SERVICES } from '@virtual-infrastructure/protocol/services'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/record'

test('there is a service path for each domain', () => {
    expect(SERVICES).toEqual({ users: 'users', servers: 'servers' })
})

test('the data service has a default port', () => {
    expect(DATA_SERVICE_PORT).toBe(3030)
})

test('records are identified by id', () => {
    const user: UserRecord = {
        id: 'u1',
        name: 'Alice',
        commandsPerMinute: 8,
        commandMix: { search: 0.7, standard: 0.2, agentic: 0.1 },
        frustration: 0,
    }
    const server: ServerRecord = { id: 's1', name: 'Server 1', capacity: 10, load: 4, activeCommands: 1 }
    expect([user.id, server.id]).toEqual(['u1', 's1'])
})

test.each(['events', 'users/routes', 'users/commands', 'users/constants', 'servers/routes', 'servers/commands', 'servers/constants'])(
    '%s loads',
    async (path) => {
        expect(await import(`@virtual-infrastructure/protocol/${path}`)).toBeDefined()
    },
)
