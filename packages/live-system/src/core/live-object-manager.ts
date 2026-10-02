// LiveObjectManager: a data manager that owns a live object for each of its records.
import { DataManager } from './data-manager.ts'
import type { LiveObject, LiveObjectOptions } from './live-object.ts'
import type { HasId } from './record-source.ts'

type Step = (object: LiveObject) => void | Promise<void>

// The startup steps of a live object, in order. They are the manager's own phases.
const steps: Step[] = [object => object.init(), object => object.start(), object => object.run()]

/**
 * A data manager whose records each have a live object. It creates the object
 * when the record appears and destroys it when the record is removed. An
 * object goes through the manager's phases with it: `init()`, `start()` and
 * `run()`. One created later is taken through every phase its manager has
 * reached, one after the other.
 */
export abstract class LiveObjectManager<T extends HasId, O extends LiveObject, C = unknown> extends DataManager<T, C> {
    #objects = new Map<string, O>()
    // How many of the steps the manager has reached
    #reached = 0
    // Each object's steps so far, so its next one waits for them
    #progress = new Map<O, Promise<void>>()

    /** The live objects, by their record's ID. */
    get objects(): ReadonlyMap<string, O> {
        return this.#objects
    }

    getObject(id: string): O | undefined {
        return this.#objects.get(id)
    }

    /** Loads the records, creates their objects and awaits each object's `init()`. */
    override async init(): Promise<void> {
        await super.init()
        await this.#reach(1)
    }

    override async start(): Promise<void> {
        await super.start()
        await this.#reach(2)
    }

    override async run(): Promise<void> {
        await super.run()
        await this.#reach(3)
    }

    /** Ends the subscriptions, then destroys every object, the last created first. */
    override async stop(): Promise<void> {
        await super.stop()

        const errors: unknown[] = []

        for (const object of [...this.#objects.values()].reverse()) {
            try {
                object.destroy()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Several live objects failed to be destroyed')
    }

    /**
     * Creates the live object for a record. It only constructs: the object
     * begins its work in its own `init()`, `start()` and `run()`. The options
     * are passed on to `LiveObject`, so the manager hears of the object's end.
     */
    protected abstract createObject(record: T, options: LiveObjectOptions): O

    /**
     * Called when an object's `init()`, `start()` or `run()` failed. The object
     * has been destroyed, and the others are not affected. Logs with
     * `console.error` by default.
     */
    protected objectFailed(_object: O, error: unknown): void {
        console.error(`${this.constructor.name}: a live object failed to start`, error)
    }

    protected override recordAdded(record: T): void {
        if (this.#objects.has(record.id)) return

        const object: O = this.createObject(record, {
            onDestroyed: () => {
                this.#progress.delete(object)

                if (this.#objects.get(record.id) === object) this.#objects.delete(record.id)
            }
        })

        this.#objects.set(record.id, object)

        for (const step of steps.slice(0, this.#reached)) {
            // Its failure has been reported; a failing report is all that is left to log
            this.#advance(object, step).catch(error => console.error(error))
        }
    }

    protected override recordRemoved(record: T): void {
        this.#objects.get(record.id)?.destroy()
    }

    // Moves the manager to a phase, and every object with it
    async #reach(reached: number): Promise<void> {
        const step = steps[reached - 1]
        this.#reached = reached

        if (!step) return

        await Promise.all([...this.#objects.values()].map(object => this.#advance(object, step)))
    }

    // Runs a step of an object after its earlier ones. A step that fails ends the object, not the manager.
    #advance(object: O, step: Step): Promise<void> {
        const earlier = this.#progress.get(object) ?? Promise.resolve()

        const done = earlier.then(async () => {
            if (object.isDestroyed) return

            try {
                await step(object)
            } catch (error) {
                try {
                    object.destroy()
                } finally {
                    this.objectFailed(object, error)
                }
            }
        })

        if (!object.isDestroyed) this.#progress.set(object, done.catch(() => {}))

        return done
    }
}
