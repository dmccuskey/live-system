/** What the `ServerManager` reports of the servers as a whole, for the UI to show. */
export interface ServerStatusRecord {
    /** Given by the data service. */
    id: string
    /** The key of the manager whose status this is, from `STATUS_KEYS`: that manager provides what the record holds. */
    key: string
    /** How many commands wait in the queue. */
    queueLength: number
    /** The load of all servers over their capacity, a fraction from 0 to 1. With no server, 0. */
    utilization: number
}

/** A status record: one per manager that reports its status. So far there is the `ServerManager`'s. */
export type StatusRecord = ServerStatusRecord
