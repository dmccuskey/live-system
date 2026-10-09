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

/** The fewest and the most servers automatic scaling keeps. */
export const MIN_SERVERS = 1
export const MAX_SERVERS = 8

/** How often the load is sampled, in milliseconds. */
export const SCALING_SAMPLE_INTERVAL = 1_000

/**
 * How long the utilization is averaged over, in milliseconds. Commands start and
 * end all the time, so the average is what the UI shows and what automatic scaling goes by.
 */
export const UTILIZATION_WINDOW = 10_000

/** How far back the throughput looks, in milliseconds: the commands completed, and those requested, in the last minute. */
export const THROUGHPUT_WINDOW = 60_000

/** How long after a decision the next server may be added, in milliseconds. */
export const SCALE_UP_WAIT = 5_000

/** How long after a decision the next server may be removed, in milliseconds. */
export const SCALE_DOWN_WAIT = 15_000

/**
 * How far above the maximum the utilization may go before a server is added,
 * and how far below it before one is removed. The band is narrow so that the
 * demo moves: servers come and go as the load does.
 */
export const SCALE_UP_MARGIN = 0.05
export const SCALE_DOWN_MARGIN = 0.15
