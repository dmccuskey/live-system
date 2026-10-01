import { expect, test } from 'bun:test'

test('the core entry point loads', async () => {
    expect(await import('live-system/core')).toBeDefined()
})
