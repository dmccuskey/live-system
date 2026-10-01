import { expect, test } from 'bun:test'
import pkg from '../package.json'

test('the package loads', async () => {
    expect(await import('feathers-connect')).toBeDefined()
})

test('the package does not depend on LiveSystem', () => {
    const deps: Record<string, string> = 'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {}
    expect(Object.keys(deps)).not.toContain('live-system')
})
