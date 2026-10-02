// The command data types and command creators of the settings domain.
import { fillRoute, type Command } from 'live-system/core'
import type { SettingsRecord } from './settings.record.ts'
import { SETTINGS_ROUTES } from './settings.routes.ts'

/** What `settings/:key/update` takes: the settings to change. One left out stays as it is. */
export type SettingsUpdate = Partial<Omit<SettingsRecord, 'id' | 'key'>>

/** Changes the settings of one manager, named by its key in `SETTINGS_KEYS`. */
export function createUpdateSettingsCommand(key: string, changes: SettingsUpdate): Command<SettingsUpdate> {
    return { route: fillRoute(SETTINGS_ROUTES.update, { key }), data: changes }
}
