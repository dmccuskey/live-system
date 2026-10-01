import { expect, test } from 'bun:test'

test('the web entry point loads', async () => {
    expect(await import('live-system/web')).toBeDefined()
})
