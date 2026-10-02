import { describe, expect, test } from 'bun:test'
import {
    FRUSTRATION_ABORTED,
    FRUSTRATION_PER_SECOND_QUEUED,
    FRUSTRATION_REFUSED,
    FRUSTRATION_RELIEF,
} from '@virtual-infrastructure/protocol/users/users.constants'
import { afterAborted, afterCompleted, afterQueued, afterRefused } from './frustration.ts'

describe('bad outcomes', () => {
    test('a refusal adds its bump', () => {
        expect(afterRefused(0.2)).toBeCloseTo(0.2 + FRUSTRATION_REFUSED)
    })

    test('a wait in the queue adds more the longer it was', () => {
        expect(afterQueued(0.2, 0)).toBe(0.2)
        expect(afterQueued(0.2, 1000)).toBeCloseTo(0.2 + FRUSTRATION_PER_SECOND_QUEUED)
        expect(afterQueued(0.2, 10_000)).toBeCloseTo(0.2 + 10 * FRUSTRATION_PER_SECOND_QUEUED)
    })

    test('a negative wait adds nothing', () => {
        expect(afterQueued(0.2, -500)).toBe(0.2)
    })

    test('an abort adds more the longer the command had run', () => {
        expect(afterAborted(0.2, 0.5)).toBeCloseTo(0.2 + FRUSTRATION_REFUSED + FRUSTRATION_ABORTED / 2)
        expect(afterAborted(0.2, 1)).toBeCloseTo(0.2 + FRUSTRATION_REFUSED + FRUSTRATION_ABORTED)
    })

    test('an abort is never less than a refusal', () => {
        expect(afterAborted(0.2, 0)).toBeCloseTo(afterRefused(0.2))
        expect(afterAborted(0.2, 0.01)).toBeGreaterThan(afterRefused(0.2))
    })

    test('the fraction run is held to 0 to 1', () => {
        expect(afterAborted(0.2, 3)).toBeCloseTo(afterAborted(0.2, 1))
        expect(afterAborted(0.2, -1)).toBeCloseTo(afterAborted(0.2, 0))
    })

    test('frustration never exceeds 1', () => {
        expect(afterRefused(0.99)).toBe(1)
        expect(afterQueued(0.5, 3_600_000)).toBe(1)
        expect(afterAborted(0.95, 1)).toBe(1)
    })
})

describe('relief', () => {
    test('a completed command scales the frustration down', () => {
        expect(afterCompleted(0.5)).toBeCloseTo(0.5 * FRUSTRATION_RELIEF)
    })

    test('no frustration stays none', () => {
        expect(afterCompleted(0)).toBe(0)
    })

    test('a busy user recovers: enough completed commands halve it', () => {
        let frustration = 0.8
        let commands = 0

        while (frustration > 0.4) {
            frustration = afterCompleted(frustration)
            commands++
        }

        expect(commands).toBe(Math.ceil(Math.log(0.5) / Math.log(FRUSTRATION_RELIEF)))
    })
})
