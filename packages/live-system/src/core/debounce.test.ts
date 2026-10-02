import { describe, expect, test } from 'bun:test'
import { debouncePatch } from 'live-system/core'

interface Item {
    id: string
    name: string
    count: number
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('debouncePatch()', () => {
    test('writes nothing until the delay has passed', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 20)

        debounced.patch({ count: 1 })

        expect(writes).toEqual([])
        expect(debounced.isPending).toBe(true)

        await wait(40)

        expect(writes).toEqual([{ count: 1 }])
        expect(debounced.isPending).toBe(false)
    })

    test('merges the updates into one write, the later value winning', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 20)

        debounced.patch({ count: 1 })
        debounced.patch({ name: 'renamed' })
        debounced.patch({ count: 3 })
        await wait(40)

        expect(writes).toEqual([{ count: 3, name: 'renamed' }])
    })

    test('each update restarts the delay', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 40)

        debounced.patch({ count: 1 })
        await wait(25)
        debounced.patch({ count: 2 })
        await wait(25)

        expect(writes).toEqual([])

        await wait(40)

        expect(writes).toEqual([{ count: 2 }])
    })

    test('updates after a write start a new one', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10)

        debounced.patch({ count: 1 })
        await wait(30)
        debounced.patch({ name: 'renamed' })
        await wait(30)

        expect(writes).toEqual([{ count: 1 }, { name: 'renamed' }])
    })

    test('flush() writes at once and waits for the write', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(async data => {
            await wait(5)
            writes.push(data)
        }, 1000)

        debounced.patch({ count: 1 })
        await debounced.flush()

        expect(writes).toEqual([{ count: 1 }])
        expect(debounced.isPending).toBe(false)
    })

    test('flush() leaves nothing for the timer to write', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10)

        debounced.patch({ count: 1 })
        await debounced.flush()
        await wait(30)

        expect(writes).toHaveLength(1)
    })

    test('flush() with nothing pending writes nothing', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10)

        await debounced.flush()

        expect(writes).toEqual([])
    })

    test('flush() rejects with what the write failed with', async () => {
        const debounced = debouncePatch<Item>(() => Promise.reject(new Error('write failed')), 1000)

        debounced.patch({ count: 1 })

        expect(debounced.flush()).rejects.toThrow('write failed')
    })

    test('cancel() drops the pending update', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10)

        debounced.patch({ count: 1 })
        debounced.cancel()
        await wait(30)

        expect(writes).toEqual([])
        expect(debounced.isPending).toBe(false)
    })

    test('it can be used again after cancel()', async () => {
        const writes: Partial<Item>[] = []
        const debounced = debouncePatch<Item>(data => writes.push(data), 10)

        debounced.patch({ count: 1 })
        debounced.cancel()
        debounced.patch({ name: 'renamed' })
        await wait(30)

        expect(writes).toEqual([{ name: 'renamed' }])
    })

    test('a delayed write that fails is reported to onError', async () => {
        const errors: unknown[] = []
        const failure = new Error('write failed')
        const debounced = debouncePatch<Item>(() => Promise.reject(failure), 10, {
            onError: error => errors.push(error)
        })

        debounced.patch({ count: 1 })
        await wait(30)

        expect(errors).toEqual([failure])
    })

    test('a delayed write that throws is reported to onError', async () => {
        const errors: unknown[] = []
        const failure = new Error('write failed')
        const debounced = debouncePatch<Item>(
            () => {
                throw failure
            },
            10,
            { onError: error => errors.push(error) }
        )

        debounced.patch({ count: 1 })
        await wait(30)

        expect(errors).toEqual([failure])
    })
})
