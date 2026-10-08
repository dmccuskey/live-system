// The constants of the managers domain.
import type { ManagerKey, ManagerRecords } from './managers.record.ts'

/** The keys of the manager records, by the manager each belongs to. */
export const MANAGER_KEYS = {
    servers: 'servers',
} as const satisfies { [K in ManagerKey]: K }

/**
 * What every manager's record begins with. A manager creates its own record
 * from this when there is none, and falls back on it should the record go
 * missing. What a manager reports is of the run it is reported in, so an
 * earlier run's is replaced by what is here. A key without an entry is a type error.
 */
export const DEFAULT_MANAGER_RECORDS: { [K in ManagerKey]: Omit<ManagerRecords[K], 'id'> } = {
    [MANAGER_KEYS.servers]: {
        key: MANAGER_KEYS.servers,
        scalingMode: 'automatic',
        maxUtilization: 0.75,
        queueLength: 0,
        waitingForRoom: 0,
        utilization: 0,
    },
}

/** The lowest and the highest maximum utilization the Demo User may set for the `ServerManager`. */
export const MIN_MAX_UTILIZATION = 0.3
export const MAX_MAX_UTILIZATION = 0.95
