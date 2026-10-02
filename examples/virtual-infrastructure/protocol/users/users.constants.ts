// The constants of the users domain.

/** The fewest and the most commands a new user sends in a minute. */
export const MIN_COMMANDS_PER_MINUTE = 4
export const MAX_COMMANDS_PER_MINUTE = 20

/**
 * How a user's frustration, a fraction from 0 to 1, moves with what becomes
 * of its commands. Placeholders, to be tuned once the demo runs.
 */

/** Added when a command is refused because the user already has one waiting. */
export const FRUSTRATION_REFUSED = 0.05

/** Added for each second a command waited in the queue before a server took it. */
export const FRUSTRATION_PER_SECOND_QUEUED = 0.01

/**
 * Added on top of `FRUSTRATION_REFUSED` when a command is aborted, in full for a command
 * that had run its whole duration: the longer it ran, the more work the user lost.
 */
export const FRUSTRATION_ABORTED = 0.15

/** What a completed command multiplies the frustration by: relief. */
export const FRUSTRATION_RELIEF = 0.9

/** The names new users are given, in order. */
export const USER_NAMES = [
    'Alice',
    'Bob',
    'Charlie',
    'Dana',
    'Eli',
    'Fiona',
    'Gus',
    'Hana',
    'Ivan',
    'Jade',
    'Kofi',
    'Lena',
] as const
