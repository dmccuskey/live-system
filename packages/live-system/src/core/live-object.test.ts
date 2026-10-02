import { describe, expect, test } from 'bun:test'
import { LiveObject } from 'live-system/core'
import type { LiveObjectOptions, Unsubscribe } from 'live-system/core'

// An object that holds one subscription and counts how often it lets go of it
class Ticker extends LiveObject {
    released = 0
    #unsubscribe: Unsubscribe

    constructor(unsubscribe: Unsubscribe, options?: LiveObjectOptions) {
        super(options)
        this.#unsubscribe = unsubscribe
    }

    protected override release(): void {
        this.released += 1
        this.#unsubscribe()
    }
}

describe('destroy()', () => {
    test('a new object is not destroyed', () => {
        const object = new Ticker(() => {})

        expect(object.isDestroyed).toBe(false)
        expect(object.released).toBe(0)
    })

    test('releases what the object holds, then tells the owner', () => {
        const calls: string[] = []
        const object = new Ticker(() => calls.push('unsubscribe'), {
            onDestroyed: () => calls.push('onDestroyed')
        })

        object.destroy()

        expect(object.isDestroyed).toBe(true)
        expect(calls).toEqual(['unsubscribe', 'onDestroyed'])
    })

    test('does nothing the second time', () => {
        let told = 0
        const object = new Ticker(() => {}, { onDestroyed: () => (told += 1) })

        object.destroy()
        object.destroy()

        expect(object.released).toBe(1)
        expect(told).toBe(1)
    })

    test('works without an owner to tell', () => {
        const object = new Ticker(() => {})

        object.destroy()

        expect(object.isDestroyed).toBe(true)
    })

    test('an object with nothing to release needs no release()', () => {
        class Plain extends LiveObject {}
        const object = new Plain()

        object.destroy()

        expect(object.isDestroyed).toBe(true)
    })

    test('tells the owner even when the release fails, and passes the error on', () => {
        let told = 0
        const object = new Ticker(
            () => {
                throw new Error('no such listener')
            },
            { onDestroyed: () => (told += 1) }
        )

        expect(() => object.destroy()).toThrow('no such listener')
        expect(object.isDestroyed).toBe(true)
        expect(told).toBe(1)
    })

    test('is already destroyed when the owner is told', () => {
        let seen: boolean | undefined
        const object: Ticker = new Ticker(() => {}, { onDestroyed: () => (seen = object.isDestroyed) })

        object.destroy()

        expect(seen).toBe(true)
    })
})

describe('ownership', () => {
    // An owner that keeps its objects in a registry of its own
    class Owner {
        readonly objects = new Map<string, Ticker>()

        create(id: string): Ticker {
            const object = new Ticker(() => {}, { onDestroyed: () => this.objects.delete(id) })
            this.objects.set(id, object)
            return object
        }

        destroyAll(): void {
            for (const object of [...this.objects.values()]) object.destroy()
        }
    }

    test('an object that ends its own life leaves its owner\'s registry', () => {
        const owner = new Owner()
        const first = owner.create('a')
        owner.create('b')

        first.destroy()

        expect([...owner.objects.keys()]).toEqual(['b'])
    })

    test('the owner destroys every object it holds', () => {
        const owner = new Owner()
        const objects = [owner.create('a'), owner.create('b')]

        owner.destroyAll()

        expect(owner.objects.size).toBe(0)
        expect(objects.every(object => object.isDestroyed)).toBe(true)
    })

    test('two owners do not share objects', () => {
        const one = new Owner()
        const other = new Owner()
        one.create('a')
        other.create('a')

        one.destroyAll()

        expect(other.objects.size).toBe(1)
    })
})
