import { describe, expect, test } from 'bun:test'
import { RecentWindow } from './recent-window.ts'

describe('RecentWindow', () => {
    test('with nothing added it has no values, and nothing to wait for', () => {
        const recent = new RecentWindow<string>(1_000)

        expect(recent.values(0)).toEqual([])
        expect(recent.untilNext(0)).toBeUndefined()
    })

    test('it gives the values added less than its span ago, the oldest first', () => {
        const recent = new RecentWindow<string>(1_000)

        recent.add(0, 'a')
        recent.add(400, 'b')
        recent.add(900, 'c')

        expect(recent.values(900)).toEqual(['a', 'b', 'c'])
        expect(recent.values(999)).toEqual(['a', 'b', 'c'])
        expect(recent.values(1_399)).toEqual(['b', 'c'])
        expect(recent.values(1_900)).toEqual([])
    })

    test('a value leaves when it is as old as the span', () => {
        const recent = new RecentWindow<string>(1_000)

        recent.add(0, 'a')

        expect(recent.values(1_000)).toEqual([])
    })

    test('untilNext() is the time the oldest value has left', () => {
        const recent = new RecentWindow<string>(1_000)

        recent.add(100, 'a')
        recent.add(600, 'b')

        expect(recent.untilNext(300)).toBe(800)
        expect(recent.untilNext(1_100)).toBe(500)
        expect(recent.untilNext(1_600)).toBeUndefined()
    })

    test('a value that is still there always has time left, with fractions of a millisecond too', () => {
        // 6805.3 + 30000 is 36805.3, and 36805.3 - 6805.3 is a little less than 30000
        const recent = new RecentWindow<string>(30_000)

        recent.add(6_805.3, 'a')

        expect(recent.values(36_805.3)).toEqual([])
        expect(recent.untilNext(36_805.3)).toBeUndefined()
    })

    test('clear() empties it', () => {
        const recent = new RecentWindow<string>(1_000)

        recent.add(0, 'a')
        recent.clear()

        expect(recent.values(1)).toEqual([])
    })
})
