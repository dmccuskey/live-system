// The live server's stores: one per kind of record, each a projection of its service in the data service.
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { defineRecordStore } from 'live-system/core'

// Each is called with the context's Pinia instance. Only the manager of a kind of record writes to its store.
export const useUserStore = defineRecordStore<UserRecord>(SERVICES.users)
export const useServerStore = defineRecordStore<ServerRecord>(SERVICES.servers)
export const useSettingsStore = defineRecordStore<SettingsRecord>(SERVICES.settings)
export const useStatusStore = defineRecordStore<StatusRecord>(SERVICES.status)
