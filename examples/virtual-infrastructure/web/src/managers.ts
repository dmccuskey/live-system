// The web app's managers: one per kind of record. Each mirrors its service into its store and does nothing else,
// because a web app has no live objects and never writes records.
import type { ManagerRecord } from '@virtual-infrastructure/protocol/managers/managers.record'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { DataManager } from 'live-system/core'
import type { WebContext } from './context.ts'

export class UserManager extends DataManager<UserRecord, WebContext> {}

export class ServerManager extends DataManager<ServerRecord, WebContext> {}

/** The live server's managers each have a record of their own: these, by the manager's key. */
export class ManagerRecords extends DataManager<ManagerRecord, WebContext> {}
