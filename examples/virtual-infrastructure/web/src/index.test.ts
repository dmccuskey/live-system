import { expect, test } from 'bun:test'
import { SERVICES } from '@virtual-infrastructure/protocol/services'

test('the web app loads', async () => {
    expect(await import('./index.ts')).toBeDefined()
})

test.each(['live-system/core', 'live-system/web', 'feathers-connect'])('%s resolves', async name => {
    expect(await import(name)).toBeDefined()
})

test('the protocol resolves', () => {
    expect(SERVICES.users).toBe('users')
})
