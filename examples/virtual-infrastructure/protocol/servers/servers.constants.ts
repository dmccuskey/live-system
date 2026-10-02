// The constants of the servers domain.
import type { CommandMix } from '../users/users.record.ts'

/** The kinds of command a user sends and a server runs. */
export type CommandType = keyof CommandMix

export interface CommandTypeSpec {
    /** The capacity units a command takes up while it runs, a whole number. */
    cost: number
    /** How long a command runs, in milliseconds. */
    duration: number
}

/** What each kind of command costs. Placeholders, to be tuned once the demo runs. */
export const COMMAND_TYPES: Record<CommandType, CommandTypeSpec> = {
    search: { cost: 1, duration: 2_000 },
    standard: { cost: 2, duration: 5_000 },
    agentic: { cost: 4, duration: 15_000 },
}

/** The capacity of a new server, in whole units. */
export const SERVER_CAPACITY = 10

/** How many of one user's commands may run at once. A further one waits in the queue. */
export const MAX_RUNNING_PER_USER = 3

/** How many of one user's commands may wait in the queue. A further one is refused. */
export const MAX_QUEUED_PER_USER = 1
