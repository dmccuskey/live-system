// What the components show of the stores. Each takes the Pinia instance outside a component, and none inside one.
import { DEFAULT_MANAGER_RECORDS, MANAGER_KEYS } from '@virtual-infrastructure/protocol/managers/managers.constants'
import type { ServerManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import type { Pinia } from 'pinia'
import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useManagerStore, useServerStore, useUserStore } from '../stores.ts'

// "Server 2" before "Server 10"
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true })

/** Every user, by name. */
export function useUsers(pinia?: Pinia): ComputedRef<UserRecord[]> {
    const store = useUserStore(pinia)

    return computed(() => Object.values(store.records).sort(byName))
}

/** Every server, by name. */
export function useServers(pinia?: Pinia): ComputedRef<ServerRecord[]> {
    const store = useServerStore(pinia)

    return computed(() => Object.values(store.records).sort(byName))
}

/**
 * The `ServerManager`'s record, found by its key: its settings and what it reports of the servers.
 * While there is none, the defaults.
 */
export function useServerManagerRecord(pinia?: Pinia): ComputedRef<Omit<ServerManagerRecord, 'id'>> {
    const store = useManagerStore(pinia)

    return computed(
        () =>
            Object.values(store.records).find(record => record.key === MANAGER_KEYS.servers) ??
            DEFAULT_MANAGER_RECORDS[MANAGER_KEYS.servers],
    )
}
