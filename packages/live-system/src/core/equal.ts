// isEqual: whether two records hold the same data.

/**
 * Whether two values are equal in depth, for what a record is made of:
 * primitives, arrays, plain objects and dates. The order of an object's keys
 * does not matter. A key whose value is `undefined` counts as a key.
 */
export function isEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

    if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false

        return a.every((item, index) => isEqual(item, b[index]))
    }

    const keys = Object.keys(a)

    if (keys.length !== Object.keys(b).length) return false

    return keys.every(
        key =>
            Object.hasOwn(b, key) && isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
}
