import { expect, test } from 'bun:test'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/record'

test('there is a service path for each domain', () => {
    expect(SERVICES).toEqual({ users: 'users', servers: 'servers' })
})

test('records are identified by id', () => {
    const user: UserRecord = { id: 'u1' }
    const server: ServerRecord = { id: 's1' }
    expect([user.id, server.id]).toEqual(['u1', 's1'])
})

test.each(['events', 'users/routes', 'users/commands', 'users/constants', 'servers/routes', 'servers/commands', 'servers/constants'])(
    '%s loads',
    async (path) => {
        expect(await import(`@virtual-infrastructure/protocol/${path}`)).toBeDefined()
    },
)
