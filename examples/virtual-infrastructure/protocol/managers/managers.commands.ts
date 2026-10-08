// The command data types and command creators of the managers domain.
import { fillRoute, type Command } from 'live-system/core'
import type { ManagerKey, ManagerSettings } from './managers.record.ts'
import { MANAGER_ROUTES } from './managers.routes.ts'

/** What `managers/:key/update` takes for one manager: the settings to change. One left out stays as it is. */
export type ManagerUpdate<K extends ManagerKey = ManagerKey> = Partial<ManagerSettings[K]>

/** Changes what the Demo User has set for one manager, named by its key in `MANAGER_KEYS`. */
export function createUpdateManagerCommand<K extends ManagerKey>(
    key: K,
    changes: ManagerUpdate<K>,
): Command<ManagerUpdate<K>> {
    return { route: fillRoute(MANAGER_ROUTES.update, { key }), data: changes }
}
