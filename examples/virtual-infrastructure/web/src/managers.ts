// The web app's managers: one per kind of record. Each mirrors its service into its store and does nothing else,
// because a web app has no live objects and never writes records.
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import type { SettingsRecord } from '@virtual-infrastructure/protocol/settings/settings.record'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { DataManager } from 'live-system/core'
import type { WebContext } from './context.ts'

export class UserManager extends DataManager<UserRecord, WebContext> {}

export class ServerManager extends DataManager<ServerRecord, WebContext> {}

export class SettingsManager extends DataManager<SettingsRecord, WebContext> {}

export class StatusManager extends DataManager<StatusRecord, WebContext> {}
