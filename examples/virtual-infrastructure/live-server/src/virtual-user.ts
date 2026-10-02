// VirtualUser: a user's ongoing behavior. It generates commands on its own and asks for them to be run.
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { LiveObject } from 'live-system/core'
import type { LiveObjectOptions } from 'live-system/core'
import type { DemoContext } from './context.ts'
import { pickCommandType } from './profile.ts'

/**
 * The live object of a user record. Once running it sends commands at its
 * record's rate, unevenly spaced, each of a type drawn from its command mix.
 * It sends each as a `commandRequested` event: it knows nothing of the servers.
 */
export class VirtualUser extends LiveObject {
    readonly id: string
    #record: UserRecord
    #context: DemoContext
    #timer: ReturnType<typeof setTimeout> | undefined

    constructor(record: UserRecord, context: DemoContext, options?: LiveObjectOptions) {
        super(options)
        this.id = record.id
        this.#record = record
        this.#context = context
    }

    override run(): void {
        this.#schedule()
    }

    protected override release(): void {
        clearTimeout(this.#timer)
        this.#timer = undefined
    }

    // Waits a random time, the mean of which gives the user's rate, then sends a command and waits again
    #schedule(): void {
        const rate = this.#record.commandsPerMinute

        if (this.isDestroyed || !(rate > 0)) return

        const mean = 60_000 / rate
        const delay = -Math.log(1 - this.#context.random()) * mean * this.#context.timeScale

        this.#timer = setTimeout(() => {
            this.#send()
            this.#schedule()
        }, delay)
    }

    #send(): void {
        const type = pickCommandType(this.#record.commandMix, this.#context.random())

        // What becomes of it arrives as events too: a refused command is unmet demand, which frustration will measure
        this.#context.events.emit('commandRequested', { commandId: crypto.randomUUID(), userId: this.id, type })
    }
}
