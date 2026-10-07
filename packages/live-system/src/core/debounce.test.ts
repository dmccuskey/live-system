import { describe, expect, test } from 'bun:test'
import { debouncePatch, FakeClock } from 'live-system/core'

interface Item {
    id: string
    name: string
    count: number
}

describe('debouncePatch()', () => {
    test('writes nothing until the delay has passed', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 20, { clock })

        debounced.patch({ count: 1 })

        expect(writes).toEqual([])
        expect(debounced.isPending).toBe(true)

        await clock.advance(40)

        expect(writes).toEqual([{ count: 1 }])
        expect(debounced.isPending).toBe(false)
    })

    test('merges the updates into one write, the later value winning', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 20, { clock })

        debounced.patch({ count: 1 })
        debounced.patch({ name: 'renamed' })
        debounced.patch({ count: 3 })
        await clock.advance(40)

        expect(writes).toEqual([{ count: 3, name: 'renamed' }])
    })

    test('each update restarts the delay', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 100, { clock })

        debounced.patch({ count: 1 })
        await clock.advance(60)
        debounced.patch({ count: 2 })
        await clock.advance(60)

        expect(writes).toEqual([])

        await clock.advance(100)

        expect(writes).toEqual([{ count: 2 }])
    })

    test('updates after a write start a new one', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10, { clock })

        debounced.patch({ count: 1 })
        await clock.advance(30)
        debounced.patch({ name: 'renamed' })
        await clock.advance(30)

        expect(writes).toEqual([{ count: 1 }, { name: 'renamed' }])
    })

    test('flush() writes at once and waits for the write', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(
            async data => {
                await Promise.resolve()
                writes.push(data)
            },
            1000,
            { clock },
        )

        debounced.patch({ count: 1 })
        await debounced.flush()

        expect(writes).toEqual([{ count: 1 }])
        expect(debounced.isPending).toBe(false)
    })

    test('flush() leaves nothing for the timer to write', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10, { clock })

        debounced.patch({ count: 1 })
        await debounced.flush()
        await clock.advance(30)

        expect(writes).toHaveLength(1)
    })

    test('flush() with nothing pending writes nothing', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10, { clock })

        await debounced.flush()

        expect(writes).toEqual([])
    })

    test('flush() rejects with what the write failed with', async () => {
        const clock = new FakeClock()
        const debounced = debouncePatch<Item>(() => Promise.reject(new Error('write failed')), 1000, { clock })

        debounced.patch({ count: 1 })

        expect(debounced.flush()).rejects.toThrow('write failed')
    })

    test('cancel() drops the pending update', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10, { clock })

        debounced.patch({ count: 1 })
        debounced.cancel()
        await clock.advance(30)

        expect(writes).toEqual([])
        expect(debounced.isPending).toBe(false)
    })

    test('it can be used again after cancel()', async () => {
        const clock = new FakeClock()
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10, { clock })

        debounced.patch({ count: 1 })
        debounced.cancel()
        debounced.patch({ name: 'renamed' })
        await clock.advance(30)

        expect(writes).toEqual([{ name: 'renamed' }])
    })

    test('a delayed write that fails is reported to onError', async () => {
        const clock = new FakeClock()
        const errors: unknown[] = []
        const failure = new Error('write failed')
        const debounced = debouncePatch<Item>(() => Promise.reject(failure), 10, {
            clock,
            onError: error => errors.push(error),
        })

        debounced.patch({ count: 1 })
        await clock.advance(30)

        expect(errors).toEqual([failure])
    })

    test('a delayed write that throws is reported to onError', async () => {
        const clock = new FakeClock()
        const errors: unknown[] = []
        const failure = new Error('write failed')
        const debounced = debouncePatch<Item>(
            () => {
                throw failure
            },
            10,
            { clock, onError: error => errors.push(error) },
        )

        debounced.patch({ count: 1 })
        await clock.advance(30)

        expect(errors).toEqual([failure])
    })
})
