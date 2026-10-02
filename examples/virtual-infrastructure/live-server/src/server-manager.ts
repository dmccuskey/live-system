// ServerManager: owns the servers' existence, and routes each user command to a server with room for it.
import type { CommandRequestedEvent } from '@virtual-infrastructure/protocol/events'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import {
    COMMAND_TYPES,
    MAX_QUEUED_PER_USER,
    MAX_RUNNING_PER_USER,
    SERVER_CAPACITY,
} from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVER_ROUTES } from '@virtual-infrastructure/protocol/servers/servers.routes'
import { CommandError, LiveObjectManager } from 'live-system/core'
import type { LiveObjectOptions, RouteParams, Routes, Unsubscribe } from 'live-system/core'
import type { DemoContext } from './context.ts'
import { VirtualServer } from './virtual-server.ts'

/**
 * The UI adds and removes servers through the routes. The users' commands
 * arrive over the event bus, as `commandRequested` events, and are answered
 * there: `commandStarted` from the server that takes one, `commandQueued` from
 * here when it has to wait, `commandRefused` when it will not be run.
 *
 * Commands wait in one queue, served in the order they arrived, so every
 * command accepted is run in the end. A user may have a few commands running
 * and one waiting: more than that is refused.
 */
export class ServerManager extends LiveObjectManager<ServerRecord, VirtualServer, DemoContext> {
    #subscriptions: Unsubscribe[] = []
    // The commands that wait, the longest waiting first. In memory only.
    #queue: CommandRequestedEvent[] = []
    // How many commands each user has running
    #running = new Map<string, number>()

    /** How many commands wait to be run. */
    get queueLength(): number {
        return this.#queue.length
    }

    override routes(): Routes {
        return {
            [SERVER_ROUTES.add]: this.addServer,
            [SERVER_ROUTES.remove]: this.removeServer,
        }
    }

    /** Begins to listen for commands. With no server there is nowhere for one to run: a first one is created. */
    override async start(): Promise<void> {
        await super.start()

        const { events } = this.context

        this.#subscriptions.push(
            events.on('commandRequested', event => this.#request(event)),
            events.on('commandFinished', event => this.#finished(event.userId)),
            events.on('userRemoved', event => this.#drop(queued => queued.userId === event.userId)),
        )

        if (this.objects.size === 0) await this.addServer()
    }

    async addServer(): Promise<AddServerResult> {
        const { id } = await this.source.create({
            name: `Server ${this.#nextNumber()}`,
            capacity: SERVER_CAPACITY,
            load: 0,
            activeCommands: 0,
        })

        return { id }
    }

    async removeServer(params: RouteParams): Promise<void> {
        const id = params.id

        if (!id || !this.records.get(id)) {
            throw new CommandError('not_found', `There is no server '${id}'`)
        }

        await this.source.remove(id)
    }

    /** Stops listening and drops what waits, then destroys the servers, which aborts what runs. */
    override async stop(): Promise<void> {
        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()

        this.#drop(() => true)
        this.#running.clear()

        await super.stop()
    }

    /** A new server is room for what waits. */
    protected override recordAdded(record: ServerRecord): void {
        super.recordAdded(record)
        this.#serve()
    }

    protected override createObject(record: ServerRecord, options: LiveObjectOptions): VirtualServer {
        return new VirtualServer(record, this.source, this.context, options)
    }

    // A command joins the back of the queue, unless its user has one waiting already
    #request(event: CommandRequestedEvent): void {
        const waiting = this.#queue.filter(queued => queued.userId === event.userId).length

        if (waiting >= MAX_QUEUED_PER_USER) {
            this.context.events.emit('commandRefused', { ...event, reason: 'queue_full' })
            return
        }

        this.#queue.push(event)
        this.#serve()

        if (this.#queue.includes(event)) this.context.events.emit('commandQueued', event)
    }

    // One of the user's commands has left its server: that is room on the server, and for the user
    #finished(userId: string): void {
        const running = (this.#running.get(userId) ?? 0) - 1

        if (running > 0) {
            this.#running.set(userId, running)
        } else {
            this.#running.delete(userId)
        }

        this.#serve()
    }

    /**
     * Starts what waits, from the front of the queue. A command whose user has
     * its full count running waits for that user, and is passed over. The first
     * one that waits for room ends the pass: nothing behind it starts before it,
     * however small, or a large command could wait forever.
     */
    #serve(): void {
        let index = 0

        while (index < this.#queue.length) {
            const event = this.#queue[index] as CommandRequestedEvent
            const running = this.#running.get(event.userId) ?? 0

            if (running >= MAX_RUNNING_PER_USER) {
                index++
                continue
            }

            const server = this.#serverFor(COMMAND_TYPES[event.type].cost)

            if (!server) return

            // Counted and out of the queue first: taking it emits commandStarted, which may bring a request
            this.#queue.splice(index, 1)
            this.#running.set(event.userId, running + 1)

            if (!server.take({ id: event.commandId, userId: event.userId, type: event.type })) {
                this.#running.set(event.userId, running)
                this.#queue.splice(index, 0, event)
                return
            }

            // What it started may have changed the queue: begin again at the front
            index = 0
        }
    }

    // The server with the most free capacity that has room for the cost
    #serverFor(cost: number): VirtualServer | undefined {
        let server: VirtualServer | undefined

        for (const candidate of this.objects.values()) {
            if (candidate.isDestroyed || candidate.free < cost) continue
            if (!server || candidate.free > server.free) server = candidate
        }

        return server
    }

    // Takes the matching commands out of the queue. Each is told it will not be run.
    #drop(matches: (event: CommandRequestedEvent) => boolean): void {
        const dropped = this.#queue.filter(matches)

        this.#queue = this.#queue.filter(event => !matches(event))

        for (const event of dropped) {
            this.context.events.emit('commandRefused', { ...event, reason: 'dropped' })
        }
    }

    // One more than the highest number a server's name ends in
    #nextNumber(): number {
        let highest = 0

        for (const record of Object.values(this.records.records)) {
            const number = Number(/(\d+)$/.exec(record.name)?.[1] ?? 0)

            if (number > highest) highest = number
        }

        return highest + 1
    }
}
