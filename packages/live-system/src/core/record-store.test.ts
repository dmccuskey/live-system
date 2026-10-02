import { describe, expect, test } from 'bun:test'
import { defineRecordStore } from 'live-system/core'
import { createPinia } from 'pinia'
import { computed, watch } from 'vue'

interface Item {
    id: string
    name: string
}

const first: Item = { id: 'a', name: 'first' }
const second: Item = { id: 'b', name: 'second' }

// A store of its own for each test, with no Vue app
function createStore() {
    return defineRecordStore<Item>('items')(createPinia())
}

describe('a record store', () => {
    test('starts empty', () => {
        const store = createStore()

        expect(store.records).toEqual({})
        expect(store.get('a')).toBeUndefined()
    })

    test('load() holds the records by ID', () => {
        const store = createStore()

        store.load([first, second])

        expect(store.records).toEqual({ a: first, b: second })
        expect(store.get('b')).toBe(second)
    })

    test('load() replaces what was there', () => {
        const store = createStore()
        store.load([first])

        store.load([second])

        expect(store.records).toEqual({ b: second })
    })

    test('set() adds a record and replaces one with the same ID', () => {
        const store = createStore()
        const renamed = { id: 'a', name: 'renamed' }

        store.set(first)
        store.set(second)
        store.set(renamed)

        expect(store.records).toEqual({ a: renamed, b: second })
    })

    test('remove() removes a record, and does nothing for an unknown ID', () => {
        const store = createStore()
        store.load([first, second])

        store.remove('a')
        store.remove('missing')

        expect(store.records).toEqual({ b: second })
    })

    test('the same Pinia instance gives the same store', () => {
        const pinia = createPinia()
        const useItems = defineRecordStore<Item>('items')

        useItems(pinia).set(first)

        expect(useItems(pinia).get('a')).toBe(first)
    })

    test('stores with different names are separate', () => {
        const pinia = createPinia()

        defineRecordStore<Item>('items')(pinia).set(first)

        expect(defineRecordStore<Item>('others')(pinia).records).toEqual({})
    })

    test('another Pinia instance has a store of its own', () => {
        const useItems = defineRecordStore<Item>('items')

        useItems(createPinia()).set(first)

        expect(useItems(createPinia()).records).toEqual({})
    })
})

describe('reactivity', () => {
    test('load() is one change for what watches the store', () => {
        const store = createStore()
        let changes = 0
        const stop = watch(
            () => Object.keys(store.records),
            () => (changes += 1),
            { flush: 'sync' },
        )

        store.load([first, second])
        stop()

        expect(changes).toBe(1)
    })

    test('a computed over one record follows set() and remove()', () => {
        const store = createStore()
        const name = computed(() => store.get('a')?.name)

        expect(name.value).toBeUndefined()

        store.set(first)
        expect(name.value).toBe('first')

        store.set({ id: 'a', name: 'renamed' })
        expect(name.value).toBe('renamed')

        store.remove('a')
        expect(name.value).toBeUndefined()
    })

    test('a computed over one record follows load()', () => {
        const store = createStore()
        store.set(first)
        const name = computed(() => store.get('a')?.name)

        expect(name.value).toBe('first')

        store.load([{ id: 'a', name: 'loaded' }])

        expect(name.value).toBe('loaded')
    })

    test('a change to one record does not disturb what watches another', () => {
        const store = createStore()
        store.load([first, second])
        let changes = 0
        const stop = watch(
            () => store.get('a'),
            () => (changes += 1),
            { flush: 'sync' },
        )

        store.set({ id: 'b', name: 'renamed' })
        store.remove('b')
        stop()

        expect(changes).toBe(0)
    })

    test('a record is held as it is, not wrapped', () => {
        const store = createStore()

        store.set(first)

        expect(store.get('a')).toBe(first)
    })
})
