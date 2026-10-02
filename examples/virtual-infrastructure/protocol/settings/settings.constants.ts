// The constants of the settings domain.
import type { SettingsRecord } from './settings.record.ts'

/** The keys of the settings records, by the manager each is for. */
export const SETTINGS_KEYS = {
    servers: 'servers',
} as const

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS]

/**
 * The settings every key begins with. The `SettingsManager` creates the
 * record of each key that has none, and a manager falls back on its own
 * should its record go missing. A key without defaults is a type error.
 */
export const DEFAULT_SETTINGS: Record<SettingsKey, Omit<SettingsRecord, 'id'>> = {
    [SETTINGS_KEYS.servers]: {
        key: SETTINGS_KEYS.servers,
        scalingMode: 'automatic',
        maxUtilization: 0.75,
    },
}

/** The lowest and the highest maximum utilization the Demo User may set. */
export const MIN_MAX_UTILIZATION = 0.3
export const MAX_MAX_UTILIZATION = 0.95
