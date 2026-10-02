// VirtualServer: a server's ongoing behavior. It runs the commands it takes, within its capacity.
import type { CommandStartedEvent } from '@virtual-infrastructure/protocol/events'
import type { CommandType } from '@virtual-infrastructure/protocol/servers/servers.constants'
import { COMMAND_TYPES } from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { debouncePatch, LiveObject } from 'live-system/core'
import type { DebouncedPatch, LiveObjectOptions, RecordSource } from 'live-system/core'
import type { DemoContext } from './context.ts'

/** A user's command, as a server runs it. */
export interface ServerCommand {
    id: string
    userId: string
    type: CommandType
}

interface ActiveCommand {
    command: ServerCommand
    cost: number
    timer: ReturnType<typeof setTimeout>
}

// How long the record's load waits for another change before it is written, in milliseconds
const WRITE_DELAY = 100

/**
 * The live object of a server record. Its active commands are in memory only:
 * the record holds their count and the load they add up to. The load never
 * exceeds the capacity: a command that does not fit is not taken.
 */
export class VirtualServer extends LiveObject {
    readonly id: string
    readonly capacity: number
    #record: ServerRecord
    #context: DemoContext
    #active = new Map<string, ActiveCommand>()
    #load = 0
    #write: DebouncedPatch<ServerRecord>

    constructor(
        record: ServerRecord,
        source: RecordSource<ServerRecord>,
        context: DemoContext,
        options?: LiveObjectOptions,
    ) {
        super(options)
        this.id = record.id
        this.capacity = record.capacity
        this.#record = record
        this.#context = context
        this.#write = debouncePatch<ServerRecord>(data => source.patch(this.id, data), WRITE_DELAY * context.timeScale, {
            onError: error => {
                // A write that fails after the server has gone has nothing left to report
                if (!this.isDestroyed) console.error(`VirtualServer ${this.id}: a write failed`, error)
            },
        })
    }

    /** The capacity units the active commands take up. */
    get load(): number {
        return this.#load
    }

    /** The capacity units still free. */
    get free(): number {
        return this.capacity - this.#load
    }

    get activeCommands(): number {
        return this.#active.size
    }

    /** No command outlives the live server, so what the record says of an earlier run is cleared. */
    override async init(): Promise<void> {
        if (this.#record.load !== this.#load || this.#record.activeCommands !== this.#active.size) {
            this.#writeLoad()
            await this.#write.flush()
        }
    }

    /**
     * Runs the command, if there is room for it. Returns whether it was taken.
     * A command taken is announced with a `commandStarted` event, and finished
     * after its type's duration with a `commandFinished` event.
     */
    take(command: ServerCommand): boolean {
        const { cost, duration } = COMMAND_TYPES[command.type]

        if (this.isDestroyed || cost > this.free || this.#active.has(command.id)) return false

        const timer = setTimeout(() => this.#finish(command.id), duration * this.#context.timeScale)

        this.#active.set(command.id, { command, cost, timer })
        this.#load += cost
        this.#writeLoad()
        this.#context.events.emit('commandStarted', this.#event(command))

        return true
    }

    /** Stops the commands still running, each with a `commandFinished` event that says it was aborted. */
    protected override release(): void {
        this.#write.cancel()

        const aborted = [...this.#active.values()]

        this.#active.clear()
        this.#load = 0

        for (const { command, timer } of aborted) {
            clearTimeout(timer)
            this.#emitFinished(command, 'aborted')
        }
    }

    #finish(commandId: string): void {
        const active = this.#active.get(commandId)

        if (!active) return

        this.#active.delete(commandId)
        this.#load -= active.cost
        this.#writeLoad()
        this.#emitFinished(active.command, 'completed')
    }

    #writeLoad(): void {
        this.#write.patch({ load: this.#load, activeCommands: this.#active.size })
    }

    #emitFinished(command: ServerCommand, outcome: 'completed' | 'aborted'): void {
        this.#context.events.emit('commandFinished', { ...this.#event(command), outcome })
    }

    #event(command: ServerCommand): CommandStartedEvent {
        return { commandId: command.id, userId: command.userId, serverId: this.id, type: command.type }
    }
}
