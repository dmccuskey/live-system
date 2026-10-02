// Frustration: how a user's frustration moves with each outcome of its commands.
import {
    FRUSTRATION_ABORTED,
    FRUSTRATION_PER_SECOND_QUEUED,
    FRUSTRATION_REFUSED,
    FRUSTRATION_RELIEF,
} from '@virtual-infrastructure/protocol/users/users.constants'

// Frustration is a fraction from 0 to 1. Each function takes the current
// value and returns the new one. Bad outcomes add to it and completed
// commands relieve it. Time alone does not: a user that is not being served
// does not calm down.

const clamp = (value: number): number => Math.min(1, Math.max(0, value))

/** A command was refused because the user already has one waiting. */
export function afterRefused(frustration: number): number {
    return clamp(frustration + FRUSTRATION_REFUSED)
}

/** A command was taken by a server after waiting in the queue for `waited` milliseconds. */
export function afterQueued(frustration: number, waited: number): number {
    return clamp(frustration + (FRUSTRATION_PER_SECOND_QUEUED * Math.max(0, waited)) / 1000)
}

/**
 * A command was aborted after running for `fraction` of its duration, from 0 to 1.
 * Never less than a refusal: the user waited and then lost the work.
 */
export function afterAborted(frustration: number, fraction: number): number {
    return clamp(frustration + FRUSTRATION_REFUSED + FRUSTRATION_ABORTED * clamp(fraction))
}

/** A command ran to its end. */
export function afterCompleted(frustration: number): number {
    return clamp(frustration * FRUSTRATION_RELIEF)
}
