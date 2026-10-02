/** What the `ServerManager` reports of the servers as a whole, for the UI to show. */
export interface ServerStatusRecord {
    /** Given by the data service. */
    id: string
    /** The key of the manager whose status this is, from `STATUS_KEYS`: that manager provides what the record holds. */
    key: string
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

/** A status record: one per manager that reports its status. So far there is the `ServerManager`'s. */
export type StatusRecord = ServerStatusRecord
