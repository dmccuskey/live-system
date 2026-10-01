import { expect, test } from 'bun:test'
import pkg from '../package.json'

test('the package loads', async () => {
    expect(await import('micro-fsm')).toBeDefined()
})

test('the package has no dependencies', () => {
    expect(Object.keys(pkg)).not.toContain('dependencies')
})
