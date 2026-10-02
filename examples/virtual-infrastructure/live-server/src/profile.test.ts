import { describe, expect, test } from 'bun:test'
import { MAX_COMMANDS_PER_MINUTE, MIN_COMMANDS_PER_MINUTE } from '@virtual-infrastructure/protocol/users/users.constants'
import { createProfile, pickCommandType } from './profile.ts'

/** A `random` that hands out the values in turn, over and over. */
const sequence = (...values: number[]) => {
    let index = 0

    return () => values[index++ % values.length] as number
}

describe('createProfile', () => {
    test('the rate spans the range', () => {
        expect(createProfile(sequence(0, 0.5, 0.5, 0.5)).commandsPerMinute).toBe(MIN_COMMANDS_PER_MINUTE)
        expect(createProfile(sequence(0.999999, 0.5, 0.5, 0.5)).commandsPerMinute).toBe(MAX_COMMANDS_PER_MINUTE)
    })

    test('the mix follows the weights drawn', () => {
        expect(createProfile(sequence(0, 0.7, 0.2, 0.1)).commandMix).toEqual({ search: 0.7, standard: 0.2, agentic: 0.1 })
    })

    test('a mix sums to 1, in whole percents, with no share below 0', () => {
        for (let round = 0; round < 500; round++) {
            const { commandsPerMinute, commandMix } = createProfile(Math.random)
            const percents = [commandMix.search, commandMix.standard, commandMix.agentic].map(share => share * 100)

            expect(Number.isInteger(commandsPerMinute)).toBe(true)
            expect(commandsPerMinute).toBeGreaterThanOrEqual(MIN_COMMANDS_PER_MINUTE)
            expect(commandsPerMinute).toBeLessThanOrEqual(MAX_COMMANDS_PER_MINUTE)
            expect(Math.round(percents[0]! + percents[1]! + percents[2]!)).toBe(100)
            for (const percent of percents) {
                expect(percent).toBeGreaterThanOrEqual(0)
                expect(Math.abs(percent - Math.round(percent))).toBeLessThan(1e-9)
            }
        }
    })

    test('rounding that would pass 100 percent is taken from the later shares', () => {
        // 50.5 and 49.5 percent round to 51 and 50
        expect(createProfile(sequence(0, 0.505, 0.495, 0)).commandMix).toEqual({ search: 0.51, standard: 0.49, agentic: 0 })
    })

    test('weights of zero still give a mix', () => {
        expect(createProfile(() => 0).commandMix).toEqual({ search: 0.34, standard: 0.33, agentic: 0.33 })
    })
})

describe('pickCommandType', () => {
    const mix = { search: 0.7, standard: 0.2, agentic: 0.1 }

    test.each([
        [0, 'search'],
        [0.69, 'search'],
        [0.7, 'standard'],
        [0.89, 'standard'],
        [0.9, 'agentic'],
        [0.999, 'agentic'],
    ] as const)('%d falls on %s', (value, type) => {
        expect(pickCommandType(mix, value)).toBe(type)
    })

    test('a type with no share is never picked', () => {
        const none = { search: 0, standard: 1, agentic: 0 }

        expect(pickCommandType(none, 0)).toBe('standard')
        expect(pickCommandType(none, 0.999)).toBe('standard')
    })
})
