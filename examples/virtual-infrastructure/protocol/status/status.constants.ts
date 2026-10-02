// The constants of the status domain.
import type { StatusRecord } from './status.record.ts'

/** The keys of the status records, by the manager that provides each one's data. */
export const STATUS_KEYS = {
    servers: 'servers',
} as const

export type StatusKey = (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS]

/**
 * The status every key begins a run with. The `StatusManager` creates the
 * record of each key that has none, and resets the others to this. For the
 * servers: nothing waits and nothing runs.
 */
export const INITIAL_STATUS: Record<StatusKey, Omit<StatusRecord, 'id'>> = {
    [STATUS_KEYS.servers]: {
        key: STATUS_KEYS.servers,
        queueLength: 0,
        utilization: 0,
    },
}
