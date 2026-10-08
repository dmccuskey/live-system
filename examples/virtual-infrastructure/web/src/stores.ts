// The web app's stores: one per kind of record, each a projection of its service in the data service.
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { defineRecordStore } from 'live-system/core'

// In a component each is called without an argument. Only the manager of a kind of record writes to its store.
export const useUserStore = defineRecordStore<UserRecord>(SERVICES.users)
export const useServerStore = defineRecordStore<ServerRecord>(SERVICES.servers)
export const useManagerStore = defineRecordStore<ManagerRecord>(SERVICES.managers)
