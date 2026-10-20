// The live server's stores: one per kind of record, each a projection of its service in the data service.
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { createRecordStore } from 'live-system/core'
import type { RecordStore } from 'live-system/core'

/** Only the manager that mirrors a kind of record writes to its store. */
export interface DemoStores {
    users: RecordStore<UserRecord>
    servers: RecordStore<ServerRecord>
    managers: RecordStore<ManagerRecord>
}

/** A store of each kind, of their own: one set per system. */
export function createStores(): DemoStores {
    return {
        users: createRecordStore(),
        servers: createRecordStore(),
        managers: createRecordStore(),
    }
}
