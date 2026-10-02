import { describe, expect, test } from 'bun:test'
import { ScalingPolicy, scaleDownMark, type ScalingDecision, type ScalingSample } from './scaling-policy.ts'

const at = (utilization: number, overrides: Partial<ScalingSample> = {}): ScalingSample => ({
    utilization,
    isQueued: false,
    maxUtilization: 0.75,
    ...overrides,
})

/** The decisions of the same sample taken a number of times. */
const repeat = (policy: ScalingPolicy, sample: ScalingSample, times: number): ScalingDecision[] =>
    Array.from({ length: times }, () => policy.sample(sample))

describe('the lower mark', () => {
    test('it is a fixed gap below the maximum', () => {
        expect(scaleDownMark(0.75)).toBeCloseTo(0.35)
        expect(scaleDownMark(0.95)).toBeCloseTo(0.55)
    })

    test('it is never below a tenth', () => {
        expect(scaleDownMark(0.3)).toBe(0.1)
        expect(scaleDownMark(0.45)).toBe(0.1)
    })
})

describe('scaling up', () => {
    test('five samples in a row above the maximum decide it', () => {
        expect(repeat(new ScalingPolicy(), at(0.8), 5)).toEqual([undefined, undefined, undefined, undefined, 'up'])
    })

    test('a sample at the maximum is not above it', () => {
        expect(repeat(new ScalingPolicy(), at(0.75), 10)).not.toContain('up')
    })

    test('a sample that is not above begins the window anew', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(0.8), 4)
        policy.sample(at(0.5))

        expect(repeat(policy, at(0.8), 5)).toEqual([undefined, undefined, undefined, undefined, 'up'])
    })

    test('commands that wait count as above, whatever the utilization', () => {
        expect(repeat(new ScalingPolicy(), at(0.2, { isQueued: true }), 5).at(-1)).toBe('up')
    })

    test('after a decision the next one needs a full window', () => {
        expect(repeat(new ScalingPolicy(), at(1), 10).filter(Boolean)).toEqual(['up', 'up'])
    })

    test('the maximum is the sample\'s own', () => {
        expect(repeat(new ScalingPolicy(), at(0.5, { maxUtilization: 0.4 }), 5).at(-1)).toBe('up')
    })
})

describe('scaling down', () => {
    test('fifteen samples in a row below the lower mark decide it', () => {
        const decisions = repeat(new ScalingPolicy(), at(0.3), 15)

        expect(decisions.slice(0, 14).every(decision => decision === undefined)).toBe(true)
        expect(decisions.at(-1)).toBe('down')
    })

    test('a sample at the lower mark is not below it', () => {
        expect(repeat(new ScalingPolicy(), at(scaleDownMark(0.75)), 30)).not.toContain('down')
    })

    test('a sample that is not below begins the window anew', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(0.1), 14)
        policy.sample(at(0.5))

        expect(repeat(policy, at(0.1), 14)).not.toContain('down')
        expect(policy.sample(at(0.1))).toBe('down')
    })

    test('nothing is removed while commands wait', () => {
        expect(repeat(new ScalingPolicy(), at(0, { isQueued: true }), 30)).not.toContain('down')
    })
})

describe('between the marks', () => {
    test('nothing is decided, however long it lasts', () => {
        expect(repeat(new ScalingPolicy(), at(0.5), 100).filter(Boolean)).toEqual([])
    })

    test('going back and forth across one mark decides nothing', () => {
        const policy = new ScalingPolicy()
        const decisions: ScalingDecision[] = []

        for (let round = 0; round < 20; round++) {
            decisions.push(...repeat(policy, at(0.8), 4), ...repeat(policy, at(0.7), 1))
        }

        expect(decisions.filter(Boolean)).toEqual([])
    })
})

test('reset() forgets the samples so far', () => {
    const policy = new ScalingPolicy()

    repeat(policy, at(0.8), 4)
    policy.reset()

    expect(policy.sample(at(0.8))).toBeUndefined()
})
