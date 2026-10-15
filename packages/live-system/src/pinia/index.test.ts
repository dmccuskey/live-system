import { expect, test } from 'bun:test'

test('the pinia entry point loads', async () => {
    expect(await import('live-system/pinia')).toBeDefined()
})
