import { expect, test } from 'bun:test'
import { createAddServerCommand, createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import {
    COMMAND_TYPES,
    MAX_QUEUED_PER_USER,
    MAX_RUNNING_PER_USER,
    SERVER_CAPACITY,
} from '@virtual-infrastructure/protocol/servers/servers.constants'
import { SERVER_ROUTES } from '@virtual-infrastructure/protocol/servers/servers.routes'
import { DATA_SERVICE_PORT, LIVE_SERVER_PORT, SERVICES } from '@virtual-infrastructure/protocol/services'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import { MAX_COMMANDS_PER_MINUTE, MIN_COMMANDS_PER_MINUTE, USER_NAMES } from '@virtual-infrastructure/protocol/users/users.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { USER_ROUTES } from '@virtual-infrastructure/protocol/users/users.routes'

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

test.each(['events', 'users/users.routes', 'users/users.commands', 'users/users.constants', 'servers/servers.routes', 'servers/servers.commands', 'servers/servers.constants'])(
    '%s loads',
    async (path) => {
        expect(await import(`@virtual-infrastructure/protocol/${path}`)).toBeDefined()
    },
)

test('the live server has a default port', () => {
    expect(LIVE_SERVER_PORT).toBe(3031)
})

test('a command type costs whole units and takes time, each more than the one before', () => {
    const { search, standard, agentic } = COMMAND_TYPES

    for (const spec of [search, standard, agentic]) {
        expect(Number.isInteger(spec.cost)).toBe(true)
        expect(spec.cost).toBeGreaterThan(0)
    }
    expect(search.cost).toBeLessThan(standard.cost)
    expect(standard.cost).toBeLessThan(agentic.cost)
    expect(search.duration).toBeLessThan(standard.duration)
    expect(standard.duration).toBeLessThan(agentic.duration)
    expect(agentic.cost).toBeLessThanOrEqual(SERVER_CAPACITY)
})

test('the command creators fill their routes', () => {
    expect(createAddUserCommand()).toEqual({ route: 'users/add', data: undefined })
    expect(createRemoveUserCommand('u1')).toEqual({ route: 'users/u1/remove', data: undefined })
    expect(createAddServerCommand()).toEqual({ route: 'servers/add', data: undefined })
    expect(createRemoveServerCommand('s1')).toEqual({ route: 'servers/s1/remove', data: undefined })
})

test('a creator refuses an empty id', () => {
    expect(() => createRemoveUserCommand('')).toThrow()
    expect(() => createRemoveServerCommand('')).toThrow()
})

test('new users have a range of rates and distinct names', () => {
    expect(MIN_COMMANDS_PER_MINUTE).toBeLessThan(MAX_COMMANDS_PER_MINUTE)
    expect(new Set(USER_NAMES).size).toBe(USER_NAMES.length)
})

test('a user command has no route: it travels over the event bus', () => {
    expect(Object.values(SERVER_ROUTES)).toEqual(['servers/add', 'servers/:id/remove'])
    expect(Object.values(USER_ROUTES)).toEqual(['users/add', 'users/:id/remove'])
})

test('a user may have three commands running and one waiting', () => {
    expect(MAX_RUNNING_PER_USER).toBe(3)
    expect(MAX_QUEUED_PER_USER).toBe(1)
})
