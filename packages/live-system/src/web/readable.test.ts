import { describe, expect, test } from 'bun:test'
import { ref } from '@vue/reactivity'
import { createRecordStore } from 'live-system/core'
import { readable, WebStartup } from 'live-system/web'

interface Item {
    id: string
    name: string
}

const first: Item = { id: 'a', name: 'first' }
const second: Item = { id: 'b', name: 'second' }

// Lets the batched listeners run
const settle = () => new Promise<void>(resolve => queueMicrotask(resolve))

describe('readable', () => {
    test('get() reads the value now', () => {
        const count = ref(1)
        const value = readable(() => count.value * 2)

        expect(value.get()).toBe(2)

        count.value = 5

        expect(value.get()).toBe(10)
    })

    test('get() returns the same value until it changes', () => {
        const store = createRecordStore<Item>()
        store.load([first, second])
        const all = readable(() => Object.values(store.records))

        expect(all.get()).toBe(all.get())

        store.set({ id: 'b', name: 'renamed' })

        expect(all.get()).toEqual([first, { id: 'b', name: 'renamed' }])
        expect(all.get()).toBe(all.get())
    })

    test('subscribe() calls the listener at once, then with each new value', async () => {
        const count = ref(1)
        const seen: number[] = []

        readable(() => count.value).subscribe(value => seen.push(value))

        expect(seen).toEqual([1])

        count.value = 2
        await settle()
        count.value = 3
        await settle()

        expect(seen).toEqual([1, 2, 3])
    })

    test('changes made together reach the listener once, with the last value', async () => {
        const store = createRecordStore<Item>()
        const seen: number[] = []
        readable(() => Object.keys(store.records).length).subscribe(size => seen.push(size))

        for (let n = 0; n < 500; n++) {
            store.set({ id: `item-${n}`, name: `item ${n}` })
        }
        await settle()

        expect(seen).toEqual([0, 500])
    })

    test('a change undone before the listeners run does not reach them', async () => {
        const count = ref(1)
        const seen: number[] = []
        readable(() => count.value).subscribe(value => seen.push(value))

        count.value = 2
        count.value = 1
        await settle()

        expect(seen).toEqual([1])
    })

    test('a change to one record does not wake the listener of another', async () => {
        const store = createRecordStore<Item>()
        store.load([first, second])
        const seen: (Item | undefined)[] = []
        readable(() => store.get('a')).subscribe(record => seen.push(record))

        store.set({ id: 'b', name: 'renamed' })
        store.remove('b')
        await settle()

        expect(seen).toEqual([first])
    })

    test('each subscriber has its own listener', async () => {
        const count = ref(1)
        const value = readable(() => count.value)
        const one: number[] = []
        const two: number[] = []

        value.subscribe(n => one.push(n))
        count.value = 2
        await settle()
        value.subscribe(n => two.push(n))
        count.value = 3
        await settle()

        expect(one).toEqual([1, 2, 3])
        expect(two).toEqual([2, 3])
    })

    test('after unsubscribing, the listener is not called again', async () => {
        const count = ref(1)
        const seen: number[] = []
        const unsubscribe = readable(() => count.value).subscribe(value => seen.push(value))

        count.value = 2
        unsubscribe()
        await settle()
        count.value = 3
        await settle()

        expect(seen).toEqual([1])
    })

    test("follows a WebStartup's status", async () => {
        let release = () => {}
        const booted = new Promise<void>(resolve => (release = resolve))
        const startup = new WebStartup({ boot: () => booted, shutdown: async () => {} })
        const seen: string[] = []
        readable(() => startup.status.phase).subscribe(phase => seen.push(phase))

        const started = startup.start()
        await settle()
        release()
        await started
        await settle()
        await startup.stop()
        await settle()

        expect(seen).toEqual(['created', 'starting', 'running', 'stopped'])
    })
})
