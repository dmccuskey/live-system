import { describe, expect, test } from 'bun:test'
import { isEqual } from './equal.ts'

describe('isEqual', () => {
    test('primitives are equal when they are the same value', () => {
        expect(isEqual(1, 1)).toBe(true)
        expect(isEqual('a', 'a')).toBe(true)
        expect(isEqual(null, null)).toBe(true)
        expect(isEqual(undefined, undefined)).toBe(true)
        expect(isEqual(NaN, NaN)).toBe(true)

        expect(isEqual(1, 2)).toBe(false)
        expect(isEqual(1, '1')).toBe(false)
        expect(isEqual(null, undefined)).toBe(false)
        expect(isEqual(0, false)).toBe(false)
    })

    test('objects are equal when their keys and values are, in any order', () => {
        expect(isEqual({ id: 'a', name: 'A' }, { name: 'A', id: 'a' })).toBe(true)
        expect(isEqual({}, {})).toBe(true)

        expect(isEqual({ id: 'a', name: 'A' }, { id: 'a', name: 'B' })).toBe(false)
        expect(isEqual({ id: 'a' }, { id: 'a', name: 'A' })).toBe(false)
        expect(isEqual({ id: 'a', name: 'A' }, { id: 'a' })).toBe(false)
    })

    test('a key that is undefined is not a missing key', () => {
        expect(isEqual({ id: 'a', name: undefined }, { id: 'a' })).toBe(false)
        expect(isEqual({ id: 'a', name: undefined }, { id: 'a', other: undefined })).toBe(false)
    })

    test('nested objects and arrays are compared in depth', () => {
        const record = () => ({ id: 'a', tags: ['x', 'y'], load: { cpu: 0.5, disks: [{ used: 1 }] } })

        expect(isEqual(record(), record())).toBe(true)
        expect(isEqual(record(), { ...record(), load: { cpu: 0.5, disks: [{ used: 2 }] } })).toBe(false)
        expect(isEqual(record(), { ...record(), tags: ['y', 'x'] })).toBe(false)
        expect(isEqual(record(), { ...record(), tags: ['x'] })).toBe(false)
    })

    test('an array is not an object with the same entries', () => {
        expect(isEqual(['a'], { 0: 'a' })).toBe(false)
        expect(isEqual([], {})).toBe(false)
    })

    test('an object is not null', () => {
        expect(isEqual({}, null)).toBe(false)
        expect(isEqual(null, {})).toBe(false)
    })

    test('dates are equal when they are the same time', () => {
        expect(isEqual(new Date(5), new Date(5))).toBe(true)
        expect(isEqual(new Date(5), new Date(6))).toBe(false)
        expect(isEqual(new Date(5), {})).toBe(false)
    })
})
