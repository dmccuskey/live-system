export interface ServerRecord {
    id: string
    name: string
    /** What the server can carry at once, in whole capacity units. */
    capacity: number
    /** The capacity units its active commands take up, a whole number. */
    load: number
    /** How many commands the server is running. */
    activeCommands: number
    /** Whether the server is on its way out: it takes no new command, and is removed when its last one ends. */
    isDraining: boolean
}
