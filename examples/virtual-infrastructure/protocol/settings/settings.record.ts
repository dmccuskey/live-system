/** Who decides how many servers there are: the `ServerManager`, or the Demo User. */
export type ScalingMode = 'automatic' | 'manual'

/** What the Demo User has set for one manager. */
export interface SettingsRecord {
    /** Given by the data service. */
    id: string
    /** The key of the manager the settings are for, from `SETTINGS_KEYS`: that manager follows this record. */
    key: string
    scalingMode: ScalingMode
    /** The utilization above which capacity is added in automatic mode, a fraction from 0 to 1. */
    maxUtilization: number
}
