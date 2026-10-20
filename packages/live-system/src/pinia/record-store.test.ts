import { describe, expect, test } from 'bun:test'
import { defineRecordStore } from 'live-system/pinia'
import { createPinia } from 'pinia'
import { testRecordStore } from '../core/record-store.contract.ts'

interface Item {
    id: string
    name: string
}

const first: Item = { id: 'a', name: 'first' }

// A store of its own for each test, with no Vue app
testRecordStore(() => defineRecordStore<Item>('items')(createPinia()))

describe('the Pinia store', () => {
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
