import { describe, expect, test } from 'bun:test'
import { ScalingPolicy, type ScalingDecision, type ScalingSample } from './scaling-policy.ts'

// Two servers, unless the test says otherwise
const at = (load: number, overrides: Partial<ScalingSample> = {}): ScalingSample => ({
    load,
    waiting: 0,
    capacity: 20,
    maxUtilization: 0.75,
    ...overrides,
})

/** The decisions of the same sample taken a number of times. */
const repeat = (policy: ScalingPolicy, sample: ScalingSample, times: number): ScalingDecision[] =>
    Array.from({ length: times }, () => policy.sample(sample))

describe('the utilization', () => {
    test('before the first sample it is 0', () => {
        expect(new ScalingPolicy().utilization).toBe(0)
    })

    test('it is the average load over the capacity', () => {
        const policy = new ScalingPolicy()

        policy.sample(at(4))
        expect(policy.utilization).toBeCloseTo(0.2)

        policy.sample(at(12))
        expect(policy.utilization).toBeCloseTo(0.4)
    })

    test('the average is over the last 10 samples', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(20), 5)
        repeat(policy, at(5), 9)
        expect(policy.utilization).toBeCloseTo((20 + 9 * 5) / 10 / 20)

        policy.sample(at(5))
        expect(policy.utilization).toBeCloseTo(0.25)
    })

    test('a change of the capacity shows at once', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(16), 3)
        policy.sample(at(16, { capacity: 40 }))

        expect(policy.utilization).toBeCloseTo(0.4)
    })

    test('what waits for room counts, up to full', () => {
        const policy = new ScalingPolicy()

        policy.sample(at(10, { waiting: 4 }))
        expect(policy.utilization).toBeCloseTo(0.7)

        policy.sample(at(20, { waiting: 30 }))
        expect(policy.utilization).toBe(1)
    })

    test('with no capacity it is full', () => {
        const policy = new ScalingPolicy()

        policy.sample(at(0, { capacity: 0 }))

        expect(policy.utilization).toBe(1)
    })

    test('reset() leaves it as it is', () => {
        const policy = new ScalingPolicy()

        policy.sample(at(8))
        policy.reset()

        expect(policy.utilization).toBeCloseTo(0.4)
    })
})

// With the maximum at 75%, the band is from 60% to 80%
describe('scaling up', () => {
    test('an average above the band decides it, once 5 samples have passed', () => {
        expect(repeat(new ScalingPolicy(), at(17), 5)).toEqual([undefined, undefined, undefined, undefined, 'up'])
    })

    test('an average just inside the top of the band is not above it', () => {
        expect(repeat(new ScalingPolicy(), at(15.9), 30)).not.toContain('up')
    })

    test('one sample below the band does not begin anew: the average decides', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(20), 3)
        policy.sample(at(10))

        expect(policy.sample(at(20))).toBe('up')
    })

    test('a short peak decides nothing', () => {
        const policy = new ScalingPolicy()

        policy.sample(at(20))

        expect(repeat(policy, at(14), 20)).not.toContain('up')
    })

    test('commands that wait for room count as demand, though the load is in the band', () => {
        expect(repeat(new ScalingPolicy(), at(14, { waiting: 4 }), 5).at(-1)).toBe('up')
    })

    test('demand beyond the capacity decides it, however high the maximum', () => {
        expect(repeat(new ScalingPolicy(), at(20, { waiting: 4, maxUtilization: 0.95 }), 5).at(-1)).toBe('up')
    })

    test('with no capacity a server is added', () => {
        expect(repeat(new ScalingPolicy(), at(0, { capacity: 0 }), 5).at(-1)).toBe('up')
    })

    test('after a decision the next one waits 5 samples', () => {
        expect(repeat(new ScalingPolicy(), at(20), 10).filter(Boolean)).toEqual(['up', 'up'])
    })

    test('capacity that was added counts at the next decision', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(17), 5)

        expect(repeat(policy, at(17, { capacity: 30 }), 30)).not.toContain('up')
    })

    test("the maximum is the sample's own", () => {
        expect(repeat(new ScalingPolicy(), at(17, { maxUtilization: 0.9 }), 30)).not.toContain('up')
        expect(repeat(new ScalingPolicy(), at(17, { maxUtilization: 0.5 }), 5).at(-1)).toBe('up')
    })
})

describe('scaling down', () => {
    test('an average below the band decides it, once 15 samples have passed', () => {
        const decisions = repeat(new ScalingPolicy(), at(11), 15)

        expect(decisions.slice(0, 14).every(decision => decision === undefined)).toBe(true)
        expect(decisions.at(-1)).toBe('down')
    })

    test('an average just inside the bottom of the band is not below it', () => {
        expect(repeat(new ScalingPolicy(), at(12.1), 40)).not.toContain('down')
    })

    test('within the band nothing is decided, however long it lasts', () => {
        expect(repeat(new ScalingPolicy(), at(14), 100).filter(Boolean)).toEqual([])
    })

    test('nothing is removed while commands wait for room', () => {
        expect(repeat(new ScalingPolicy(), at(0, { waiting: 1 }), 40)).not.toContain('down')
    })

    test('after a decision the next one waits 15 samples', () => {
        expect(repeat(new ScalingPolicy(), at(0, { capacity: 40 }), 44).filter(Boolean)).toEqual(['down', 'down'])
    })

    test('a removal waits 15 samples after an addition too', () => {
        const policy = new ScalingPolicy()

        repeat(policy, at(20), 5)

        const decisions = repeat(policy, at(0, { capacity: 30 }), 30)

        expect(decisions.indexOf('down')).toBeGreaterThanOrEqual(14)
    })
})

test('reset() begins the wait anew', () => {
    const policy = new ScalingPolicy()

    repeat(policy, at(20), 4)
    policy.reset()

    expect(repeat(policy, at(20), 5)).toEqual([undefined, undefined, undefined, undefined, 'up'])
})
