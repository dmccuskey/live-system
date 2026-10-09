/** The share of each command type in what a user sends. The three are fractions that sum to 1. */
export interface CommandMix {
    search: number
    standard: number
    agentic: number
}

export interface UserRecord {
    id: string
    name: string
    /** How many commands the user sends in a minute. Set at creation, then fixed. */
    commandsPerMinute: number
    /** Set at creation, then fixed. */
    commandMix: CommandMix
    /** From 0 (content) to 1: rises while demand goes unmet and falls as the system recovers. */
    frustration: number
    /**
     * The share of its commands that were served, a fraction from 0 to 1 in whole percent: of those
     * that came to an end within `SERVED_WINDOW`, the ones that completed. A refused or an aborted
     * command counts against it. With none, 1.
     */
    served: number
}
