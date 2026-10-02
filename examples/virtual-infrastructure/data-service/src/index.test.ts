import { expect, test } from 'bun:test'
import { SERVICES } from '@virtual-infrastructure/protocol/services'

test('the data service exports its factory', async () => {
    expect((await import('./index.ts')).createDataService).toBeFunction()
})

test('the protocol resolves', () => {
    expect(SERVICES.users).toBe('users')
})
