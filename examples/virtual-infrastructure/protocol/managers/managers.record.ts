/** Who decides how many servers there are: the `ServerManager`, or the Demo User. */
export type ScalingMode = 'automatic' | 'manual'

/**
 * The `ServerManager`'s record: what the Demo User has set for it, and what it
 * reports of the servers as a whole for the UI to show. The manager writes
 * both: a setting when its route is called, the rest as it changes.
 */
export interface ServerManagerRecord {
    /** Given by the data service. */
    id: string
    /** The key of the manager the record belongs to, from `MANAGER_KEYS`. */
    key: 'servers'
    /** Set by the Demo User. */
    scalingMode: ScalingMode
    /** Set by the Demo User: the utilization above which capacity is added in automatic mode, a fraction from 0 to 1. */
    maxUtilization: number
    /** How many commands wait in the queue. */
    queueLength: number
    /**
     * How many of them wait for room on a server: there is not enough capacity.
     * The others wait for their own user, who has as many running as a user may.
     */
    waitingForRoom: number
    /**
     * The utilization that automatic scaling goes by, a fraction from 0 to 1 in whole
     * percent: the average over `UTILIZATION_WINDOW` of the load and of what waits for room,
     * over the capacity of the servers that take commands. With no such server, 1.
     */
    utilization: number
}

/** What the Demo User may set for the `ServerManager`: the rest of its record is the manager's to report. */
export type ServerManagerSettings = Pick<ServerManagerRecord, 'scalingMode' | 'maxUtilization'>

/** Each manager's record has its own type, under the manager's key. So far there is the `ServerManager`'s. */
export interface ManagerRecords {
    servers: ServerManagerRecord
}

/** What may be set for each manager, under the manager's key. */
export interface ManagerSettings {
    servers: ServerManagerSettings
}

export type ManagerKey = keyof ManagerRecords

/** A manager record: one per manager that has one, told apart by `key`. */
export type ManagerRecord = ManagerRecords[ManagerKey]
