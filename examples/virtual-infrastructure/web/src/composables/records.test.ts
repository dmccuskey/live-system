import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '@virtual-infrastructure/protocol/settings/settings.constants'
import { INITIAL_STATUS } from '@virtual-infrastructure/protocol/status/status.constants'
import { createPinia } from 'pinia'
import { useServerStore, useSettingsStore, useStatusStore, useUserStore } from '../stores.ts'
import { serverRecord, userRecord } from '../test-support.ts'
import { useServers, useServerSettings, useServerStatus, useUsers } from './records.ts'

describe('useUsers', () => {
    test('is empty without records', () => {
        expect(useUsers(createPinia()).value).toEqual([])
    })

    test('has every user, by name', () => {
        const pinia = createPinia()

        useUserStore(pinia).load([
            userRecord({ id: 'b', name: 'Bob' }),
            userRecord({ id: 'c', name: 'Charlie' }),
            userRecord({ id: 'a', name: 'Alice' }),
        ])

        expect(useUsers(pinia).value.map(user => user.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    test('follows the store', () => {
        const pinia = createPinia()
        const store = useUserStore(pinia)
        const users = useUsers(pinia)

        store.load([userRecord({ id: 'a', name: 'Alice' })])
        expect(users.value).toHaveLength(1)

        store.set(userRecord({ id: 'b', name: 'Bob' }))
        expect(users.value.map(user => user.name)).toEqual(['Alice', 'Bob'])

        store.set(userRecord({ id: 'a', name: 'Alice', frustration: 0.5 }))
        expect(users.value[0]?.frustration).toBe(0.5)

        store.remove('a')
        expect(users.value.map(user => user.name)).toEqual(['Bob'])
    })
})

describe('useServers', () => {
    test('has every server, by name, with numbers in order', () => {
        const pinia = createPinia()

        useServerStore(pinia).load([
            serverRecord({ id: 'a', name: 'Server 10' }),
            serverRecord({ id: 'b', name: 'Server 2' }),
            serverRecord({ id: 'c', name: 'Server 1' }),
        ])

        expect(useServers(pinia).value.map(server => server.name)).toEqual(['Server 1', 'Server 2', 'Server 10'])
    })

    test('follows the store', () => {
        const pinia = createPinia()
        const store = useServerStore(pinia)
        const servers = useServers(pinia)

        expect(servers.value).toEqual([])

        store.set(serverRecord())
        expect(servers.value).toHaveLength(1)

        store.remove('s1')
        expect(servers.value).toEqual([])
    })
})

describe('useServerSettings', () => {
    test('is the defaults while there is no record', () => {
        expect(useServerSettings(createPinia()).value).toEqual(DEFAULT_SETTINGS.servers)
    })

    test('is the record with the key `servers`, whatever its ID', () => {
        const pinia = createPinia()

        useSettingsStore(pinia).load([
            { id: 'x', key: 'other', scalingMode: 'automatic', maxUtilization: 0.3 },
            { id: 'y', key: 'servers', scalingMode: 'manual', maxUtilization: 0.6 },
        ])

        expect(useServerSettings(pinia).value).toMatchObject({ scalingMode: 'manual', maxUtilization: 0.6 })
    })

    test('follows the record as it is replaced and removed', () => {
        const pinia = createPinia()
        const store = useSettingsStore(pinia)
        const settings = useServerSettings(pinia)

        store.set({ id: 'y', key: 'servers', scalingMode: 'manual', maxUtilization: 0.6 })
        expect(settings.value.scalingMode).toBe('manual')

        store.set({ id: 'y', key: 'servers', scalingMode: 'automatic', maxUtilization: 0.5 })
        expect(settings.value).toMatchObject({ scalingMode: 'automatic', maxUtilization: 0.5 })

        store.remove('y')
        expect(settings.value).toEqual(DEFAULT_SETTINGS.servers)
    })
})

describe('useServerStatus', () => {
    test('is the initial status while there is no record', () => {
        expect(useServerStatus(createPinia()).value).toEqual(INITIAL_STATUS.servers)
    })

    test('is the record with the key `servers`, and follows it', () => {
        const pinia = createPinia()
        const store = useStatusStore(pinia)
        const status = useServerStatus(pinia)

        store.load([
            { id: 'x', key: 'other', queueLength: 9, utilization: 0.9 },
            { id: 'y', key: 'servers', queueLength: 2, utilization: 0.5 },
        ])
        expect(status.value).toMatchObject({ queueLength: 2, utilization: 0.5 })

        store.set({ id: 'y', key: 'servers', queueLength: 0, utilization: 0.25 })
        expect(status.value).toMatchObject({ queueLength: 0, utilization: 0.25 })
    })
})
