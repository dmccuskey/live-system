import { describe, expect, test } from 'bun:test'
import { DEFAULT_MANAGER_RECORDS } from '@virtual-infrastructure/protocol/managers/managers.constants'
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import { createPinia } from 'pinia'
import { useManagerStore, useServerStore, useUserStore } from '../stores.ts'
import { serverRecord, userRecord } from '../test-support.ts'
import { useServerManagerRecord, useServers, useUsers } from './records.ts'

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

const managerRecord = (id: string, overrides: Partial<ManagerRecord> = {}): ManagerRecord => ({
    id,
    ...DEFAULT_MANAGER_RECORDS.servers,
    ...overrides,
})

describe('useServerManagerRecord', () => {
    test('is the defaults while there is no record', () => {
        expect(useServerManagerRecord(createPinia()).value).toEqual(DEFAULT_MANAGER_RECORDS.servers)
    })

    test('is the record with the key `servers`, whatever its ID', () => {
        const pinia = createPinia()

        useManagerStore(pinia).load([
            managerRecord('x', { key: 'other' as ManagerRecord['key'], maxUtilization: 0.3, queueLength: 9 }),
            managerRecord('y', { scalingMode: 'manual', maxUtilization: 0.6, queueLength: 2, utilization: 0.5 }),
        ])

        expect(useServerManagerRecord(pinia).value).toEqual(
            managerRecord('y', { scalingMode: 'manual', maxUtilization: 0.6, queueLength: 2, utilization: 0.5 }),
        )
    })

    test('follows the record as it is replaced and removed', () => {
        const pinia = createPinia()
        const store = useManagerStore(pinia)
        const record = useServerManagerRecord(pinia)

        store.set(managerRecord('y', { scalingMode: 'manual', maxUtilization: 0.6 }))
        expect(record.value.scalingMode).toBe('manual')

        store.set(managerRecord('y', { maxUtilization: 0.5, utilization: 0.25 }))
        expect(record.value).toMatchObject({ scalingMode: 'automatic', maxUtilization: 0.5, utilization: 0.25 })

        store.remove('y')
        expect(record.value).toEqual(DEFAULT_MANAGER_RECORDS.servers)
    })
})
