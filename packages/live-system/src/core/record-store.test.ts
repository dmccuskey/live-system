import { describe, expect, test } from 'bun:test'
import { createRecordStore } from 'live-system/core'
import { testRecordStore } from './record-store.contract.ts'

testRecordStore(() => createRecordStore())

describe('createRecordStore', () => {
    test('each call makes a store of its own', () => {
        const one = createRecordStore<{ id: string }>()

        one.set({ id: 'a' })

        expect(createRecordStore().records).toEqual({})
    })
})
