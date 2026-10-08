// VirtualUser: a user's ongoing behavior. It generates commands on its own and asks for them to be run.
import type {
    CommandFinishedEvent,
    CommandRefusedEvent,
    CommandStartedEvent,
} from '@virtual-infrastructure/protocol/events'
import { COMMAND_TYPES } from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { debouncePatch, LiveObject } from 'live-system/core'
import type {
    CancelTimer,
    DebouncedPatch,
    LiveObjectOptions,
    RecordSource,
    RecordStore,
    Unsubscribe,
} from 'live-system/core'
import type { DemoContext } from './context.ts'
import { afterAborted, afterCompleted, afterQueued, afterRefused } from './frustration.ts'
import { pickCommandType } from './profile.ts'

// How long the record's frustration waits for another change before it is written, in milliseconds
const WRITE_DELAY = 100

/**
 * The live object of a user record. Once running it sends commands at its
 * record's rate, unevenly spaced, each of a type drawn from its command mix.
 * It sends each as a `commandRequested` event: it knows nothing of the servers.
 *
 * It keeps its record's ID, not the record: what it needs of the record it
 * reads from the store, which has it as it is now.
 *
 * What becomes of its commands arrives as events too, and moves its
 * frustration: a refusal, a wait in the queue and an abort add to it, a
 * completed command relieves it.
 */
export class VirtualUser extends LiveObject {
    readonly id: string
    #records: RecordStore<UserRecord>
    #context: DemoContext
    #cancelTimer: CancelTimer | undefined
    #frustration = 0
    // When each of its commands began to wait in the queue, and began to run, by the command's ID
    #queuedAt = new Map<string, number>()
    #startedAt = new Map<string, number>()
    #subscriptions: Unsubscribe[] = []
    #write: DebouncedPatch<UserRecord>

    constructor(
        id: string,
        records: RecordStore<UserRecord>,
        source: RecordSource<UserRecord>,
        context: DemoContext,
        options?: LiveObjectOptions,
    ) {
        super(options)
        this.id = id
        this.#records = records
        this.#context = context
        this.#write = debouncePatch<UserRecord>(data => source.patch(this.id, data), WRITE_DELAY, {
            clock: context.clock,
            onError: error => {
                // A write that fails after the user has gone has nothing left to report
                if (!this.isDestroyed) console.error(`VirtualUser ${this.id}: a write failed`, error)
            },
        })
    }

    /** How frustrated the user is, a fraction from 0 to 1. */
    get frustration(): number {
        return this.#frustration
    }

    /** No command outlives the live server, so neither does the frustration: what the record says of an earlier run is cleared. */
    override async init(): Promise<void> {
        if ((this.#record?.frustration ?? 0) !== 0) this.#write.patch({ frustration: 0 })

        await this.#write.flush()
    }

    /** Begins to listen for what becomes of its commands. */
    override start(): void {
        const { events } = this.#context
        const own =
            <E extends { userId: string }>(listener: (event: E) => void) =>
            (event: E) => {
                if (event.userId === this.id) listener(event)
            }

        this.#subscriptions.push(
            events.on(
                'commandQueued',
                own(event => this.#queuedAt.set(event.commandId, this.#context.clock.now())),
            ),
            events.on(
                'commandStarted',
                own(event => this.#started(event)),
            ),
            events.on(
                'commandRefused',
                own(event => this.#refused(event)),
            ),
            events.on(
                'commandFinished',
                own(event => this.#finished(event)),
            ),
        )
    }

    override run(): void {
        this.#schedule()
    }

    protected override release(): void {
        this.#cancelTimer?.()
        this.#cancelTimer = undefined
        this.#write.cancel()

        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()
    }

    // The record as the store has it now. There is none once the user has been removed.
    get #record(): UserRecord | undefined {
        return this.#records.get(this.id)
    }

    // Waits a random time, the mean of which gives the user's rate, then sends a command and waits again
    #schedule(): void {
        const rate = this.#record?.commandsPerMinute ?? 0

        if (this.isDestroyed || !(rate > 0)) return

        const mean = 60_000 / rate
        const delay = -Math.log(1 - this.#context.random()) * mean

        this.#cancelTimer = this.#context.clock.after(delay, () => {
            this.#send()
            this.#schedule()
        })
    }

    #send(): void {
        const record = this.#record

        if (!record) return

        const type = pickCommandType(record.commandMix, this.#context.random())

        this.#context.events.emit('commandRequested', { commandId: crypto.randomUUID(), userId: this.id, type })
    }

    // The wait counts once, when it is over
    #started(event: CommandStartedEvent): void {
        const queuedAt = this.#queuedAt.get(event.commandId)

        this.#queuedAt.delete(event.commandId)
        this.#startedAt.set(event.commandId, this.#context.clock.now())

        if (queuedAt !== undefined) this.#set(afterQueued(this.#frustration, this.#since(queuedAt)))
    }

    // A dropped command counts as nothing, and neither does its wait: the user is gone or the system is stopping
    #refused(event: CommandRefusedEvent): void {
        this.#queuedAt.delete(event.commandId)

        if (event.reason === 'queue_full') this.#set(afterRefused(this.#frustration))
    }

    #finished(event: CommandFinishedEvent): void {
        const startedAt = this.#startedAt.get(event.commandId)

        this.#startedAt.delete(event.commandId)

        if (event.outcome === 'completed') {
            this.#set(afterCompleted(this.#frustration))
            return
        }

        const ran = startedAt === undefined ? 0 : this.#since(startedAt)

        this.#set(afterAborted(this.#frustration, ran / COMMAND_TYPES[event.type].duration))
    }

    // The milliseconds since a moment of the clock
    #since(moment: number): number {
        return this.#context.clock.now() - moment
    }

    #set(frustration: number): void {
        if (frustration === this.#frustration) return

        this.#frustration = frustration
        this.#write.patch({ frustration })
    }
}
