// A user's behavioral profile: generated when the user is created, then fixed.
import type { CommandType } from '@virtual-infrastructure/protocol/servers/servers.constants'
import {
    MAX_COMMANDS_PER_MINUTE,
    MIN_COMMANDS_PER_MINUTE,
} from '@virtual-infrastructure/protocol/users/users.constants'
import type { CommandMix, UserRecord } from '@virtual-infrastructure/protocol/users/users.record'

export type UserProfile = Pick<UserRecord, 'commandsPerMinute' | 'commandMix'>

/** A random rate within the range, and a random mix in whole percents that sum to 1. */
export function createProfile(random: () => number): UserProfile {
    const range = MAX_COMMANDS_PER_MINUTE - MIN_COMMANDS_PER_MINUTE + 1
    const commandsPerMinute = MIN_COMMANDS_PER_MINUTE + Math.min(Math.floor(random() * range), range - 1)

    const weights = [random(), random(), random()] as const
    const total = weights[0] + weights[1] + weights[2]

    // In percents, so the three sum to exactly 100 whatever the rounding does
    const search = total === 0 ? 34 : Math.round((weights[0] / total) * 100)
    const standard = total === 0 ? 33 : Math.min(Math.round((weights[1] / total) * 100), 100 - search)
    const agentic = 100 - search - standard

    return {
        commandsPerMinute,
        commandMix: { search: search / 100, standard: standard / 100, agentic: agentic / 100 },
    }
}

/** The command type a number from 0 up to 1 falls on, each type having its share of that range. */
export function pickCommandType(mix: CommandMix, value: number): CommandType {
    if (value < mix.search) return 'search'
    if (value < mix.search + mix.standard) return 'standard'
    return 'agentic'
}
