import { expect, test } from 'bun:test'
import { level, mood, percent } from './format.ts'

test.each([
    [0, '0%'],
    [0.14, '14%'],
    [0.756, '76%'],
    [1, '100%'],
])('percent(%p) is %p', (fraction, text) => {
    expect(percent(fraction)).toBe(text)
})

test.each([
    [0, 'low'],
    [0.33, 'low'],
    [0.34, 'medium'],
    [0.66, 'medium'],
    [0.67, 'high'],
    [1, 'high'],
] as const)('level(%p) is %p', (fraction, expected) => {
    expect(level(fraction)).toBe(expected)
})

test.each([
    [0, 'calm'],
    [0.24, 'calm'],
    [0.25, 'uneasy'],
    [0.49, 'uneasy'],
    [0.5, 'annoyed'],
    [0.74, 'annoyed'],
    [0.75, 'angry'],
    [1, 'angry'],
] as const)('mood(%p) is %p', (frustration, expected) => {
    expect(mood(frustration)).toBe(expected)
})
