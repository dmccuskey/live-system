import { expect, test } from 'bun:test'
import { createAddServerCommand, createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import {
    COMMAND_TYPES,
    MAX_QUEUED_PER_USER,
    MAX_RUNNING_PER_USER,
    MAX_SERVERS,
    MIN_SCALE_DOWN_UTILIZATION,
    MIN_SERVERS,
    SCALE_DOWN_GAP,
    SCALE_DOWN_WINDOW,
    SCALE_UP_WINDOW,
    SCALING_SAMPLE_INTERVAL,
    SERVER_CAPACITY,
} from '@virtual-infrastructure/protocol/servers/servers.constants'
import { SERVER_ROUTES } from '@virtual-infrastructure/protocol/servers/servers.routes'
import { DATA_SERVICE_PORT, LIVE_SERVER_PORT, SERVICES } from '@virtual-infrastructure/protocol/services'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { createUpdateSettingsCommand } from '@virtual-infrastructure/protocol/settings/settings.commands'
import {
    DEFAULT_SETTINGS,
    MAX_MAX_UTILIZATION,
    MIN_MAX_UTILIZATION,
    SETTINGS_KEYS,
} from '@virtual-infrastructure/protocol/settings/settings.constants'
import { SETTINGS_ROUTES } from '@virtual-infrastructure/protocol/settings/settings.routes'
import { INITIAL_STATUS, STATUS_KEYS } from '@virtual-infrastructure/protocol/status/status.constants'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import { MAX_COMMANDS_PER_MINUTE, MIN_COMMANDS_PER_MINUTE, USER_NAMES } from '@virtual-infrastructure/protocol/users/users.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { USER_ROUTES } from '@virtual-infrastructure/protocol/users/users.routes'

test('there is a service path for each domain', () => {
    expect(SERVICES).toEqual({ users: 'users', servers: 'servers', settings: 'settings', status: 'status' })
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
    const server: ServerRecord = { id: 's1', name: 'Server 1', capacity: 10, load: 4, activeCommands: 1, isDraining: false }
    expect([user.id, server.id]).toEqual(['u1', 's1'])
})

test.each(['events', 'users/users.routes', 'users/users.commands', 'users/users.constants', 'servers/servers.routes', 'servers/servers.commands', 'servers/servers.constants', 'settings/settings.routes', 'settings/settings.commands', 'settings/settings.constants', 'status/status.constants'])(
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

test('a settings record is keyed by the manager it is for', () => {
    expect(SETTINGS_KEYS).toEqual({ servers: 'servers' })
    expect(DEFAULT_SETTINGS.servers).toEqual({ key: SETTINGS_KEYS.servers, scalingMode: 'automatic', maxUtilization: 0.75 })
    expect(DEFAULT_SETTINGS.servers).not.toHaveProperty('id')
})

test('the default maximum utilization is one the Demo User could set', () => {
    expect(DEFAULT_SETTINGS.servers.maxUtilization).toBeGreaterThanOrEqual(MIN_MAX_UTILIZATION)
    expect(DEFAULT_SETTINGS.servers.maxUtilization).toBeLessThanOrEqual(MAX_MAX_UTILIZATION)
})

test('the settings command names the settings in its route and carries the changes', () => {
    expect(Object.values(SETTINGS_ROUTES)).toEqual(['settings/:key/update'])
    expect(createUpdateSettingsCommand(SETTINGS_KEYS.servers, { scalingMode: 'manual' })).toEqual({
        route: 'settings/servers/update',
        data: { scalingMode: 'manual' },
    })
    expect(() => createUpdateSettingsCommand('', {})).toThrow()
})

test('a status record is keyed by the manager that provides its data', () => {
    const status: StatusRecord = { id: 'x1', ...INITIAL_STATUS.servers }

    expect(STATUS_KEYS).toEqual({ servers: 'servers' })
    expect(status).toEqual({ id: 'x1', key: 'servers', queueLength: 0, utilization: 0 })
})

test('scaling down waits longer than scaling up, and its mark is below every maximum', () => {
    expect(SCALE_UP_WINDOW).toBeLessThan(SCALE_DOWN_WINDOW)
    expect(SCALING_SAMPLE_INTERVAL).toBeLessThan(SCALE_UP_WINDOW)
    expect(MIN_SCALE_DOWN_UTILIZATION).toBeLessThan(MIN_MAX_UTILIZATION)
    expect(SCALE_DOWN_GAP).toBeGreaterThan(0)
    expect(MIN_SERVERS).toBeGreaterThanOrEqual(1)
    expect(MIN_SERVERS).toBeLessThan(MAX_SERVERS)
})

test('every settings key has its defaults and every status key its initial status, under its own key', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toEqual(Object.values(SETTINGS_KEYS))
    expect(Object.keys(INITIAL_STATUS)).toEqual(Object.values(STATUS_KEYS))

    for (const [key, defaults] of Object.entries(DEFAULT_SETTINGS)) expect(defaults.key).toBe(key)
    for (const [key, initial] of Object.entries(INITIAL_STATUS)) expect(initial.key).toBe(key)
})
