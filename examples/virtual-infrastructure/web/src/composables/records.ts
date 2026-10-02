// What the components show of the stores. Each takes the Pinia instance outside a component, and none inside one.
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '@virtual-infrastructure/protocol/settings/settings.constants'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import { INITIAL_STATUS, STATUS_KEYS } from '@virtual-infrastructure/protocol/status/status.constants'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import type { Pinia } from 'pinia'
import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useServerStore, useSettingsStore, useStatusStore, useUserStore } from '../stores.ts'

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

/** The settings of the `ServerManager`: its record, found by its key, or the defaults while there is none. */
export function useServerSettings(pinia?: Pinia): ComputedRef<Omit<SettingsRecord, 'id'>> {
    const store = useSettingsStore(pinia)

    return computed(
        () =>
            Object.values(store.records).find(record => record.key === SETTINGS_KEYS.servers) ??
            DEFAULT_SETTINGS[SETTINGS_KEYS.servers],
    )
}

/** The status of the `ServerManager`: its record, found by its key, or the initial status while there is none. */
export function useServerStatus(pinia?: Pinia): ComputedRef<Omit<StatusRecord, 'id'>> {
    const store = useStatusStore(pinia)

    return computed(
        () =>
            Object.values(store.records).find(record => record.key === STATUS_KEYS.servers) ??
            INITIAL_STATUS[STATUS_KEYS.servers],
    )
}
