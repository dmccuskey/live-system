import { expect, test } from 'bun:test'

test('the server entry point loads', async () => {
    expect(await import('live-system/server')).toBeDefined()
})
