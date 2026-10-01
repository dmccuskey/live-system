import { expect, test } from 'bun:test'
import { SERVICES } from '@virtual-infrastructure/protocol/services'

test('the data service loads', async () => {
    expect(await import('./index.ts')).toBeDefined()
})

test('the protocol resolves', () => {
    expect(SERVICES.users).toBe('users')
})
