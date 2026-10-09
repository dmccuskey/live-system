// ServerManager: owns the servers' existence, routes each user command to a server with room for it,
// and in automatic mode decides how many servers there are. It owns its manager record too.
import type { CommandFinishedEvent, CommandRequestedEvent } from '@virtual-infrastructure/protocol/events'
import {
    DEFAULT_MANAGER_RECORDS,
    MANAGER_KEYS,
    MAX_MAX_UTILIZATION,
    MIN_MAX_UTILIZATION,
} from '@virtual-infrastructure/protocol/managers/managers.constants'
import type { ManagerUpdate } from '@virtual-infrastructure/protocol/managers/managers.commands'
import type { ManagerRecord, ServerManagerSettings } from '@virtual-infrastructure/protocol/managers/managers.record'
import { MANAGER_ROUTES } from '@virtual-infrastructure/protocol/managers/managers.routes'
import type { AddServerResult } from '@virtual-infrastructure/protocol/servers/servers.commands'
import {
    COMMAND_TYPES,
    MAX_QUEUED_PER_USER,
    MAX_RUNNING_PER_USER,
    MAX_SERVERS,
    MIN_SERVERS,
    SCALING_SAMPLE_INTERVAL,
    SERVER_CAPACITY,
    THROUGHPUT_WINDOW,
} from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { SERVER_ROUTES } from '@virtual-infrastructure/protocol/servers/servers.routes'
import { CommandError, debouncePatch, fillRoute, LiveObjectManager } from 'live-system/core'
import type {
    CancelTimer,
    DebouncedPatch,
    LiveObjectOptions,
    RecordSource,
    RecordStore,
    RouteParams,
    Routes,
    Unsubscribe,
} from 'live-system/core'
import { watch } from 'vue'
import type { DemoContext } from './context.ts'
import { RecentWindow } from './recent-window.ts'
import { ScalingPolicy, type ScalingDecider } from './scaling-policy.ts'
import { useManagerStore } from './stores.ts'
import { VirtualServer } from './virtual-server.ts'

// How long what the manager reports waits for another change before it is written, in milliseconds
const WRITE_DELAY = 100

const DEFAULTS = DEFAULT_MANAGER_RECORDS[MANAGER_KEYS.servers]

type SettingsUpdate = ManagerUpdate<typeof MANAGER_KEYS.servers>

// The number a server's name ends in
const serverNumber = (name: string | undefined): number => Number(/(\d+)$/.exec(name ?? '')?.[1] ?? 0)

/**
 * The UI adds and removes servers through the routes. The users' commands
 * arrive over the event bus, as `commandRequested` events, and are answered
 * there: `commandStarted` from the server that takes one, `commandQueued` from
 * here when it has to wait, `commandRefused` when it will not be run.
 *
 * Commands wait in one queue, served in the order they arrived, so every
 * command accepted is run in the end. A user may have a few commands running
 * and one waiting: more than that is refused.
 *
 * Who decides how many servers there are is a setting. In manual mode it is
 * the Demo User, through the routes. In automatic mode the routes are refused,
 * and the manager adds a server when the average utilization is above the
 * maximum, and removes one when the others would do. It keeps no more than
 * `MAX_SERVERS`: those beyond, which manual mode may have left, are removed or
 * drained. The average is the `ScalingPolicy`'s: the manager samples the load
 * in either mode.
 *
 * The manager has a record of its own among the manager records, with its
 * key, and is the only one to write it. The record holds what the Demo User
 * has set, changed through the managers' route with its key, and what the manager reports of the
 * servers as a whole for the UI to show: the queue's length, the
 * utilization, the throughput and what was requested, changes close together as one write. `init()` creates the
 * record when there is none. A setting takes effect when it comes back in the
 * manager store, which the manager watches for its record. What it reports
 * it does not read back. Should the record go missing from the store, the
 * defaults are in force.
 */
export class ServerManager extends LiveObjectManager<ServerRecord, VirtualServer, DemoContext> {
    #subscriptions: Unsubscribe[] = []
    // The commands that wait, the longest waiting first. In memory only.
    #queue: CommandRequestedEvent[] = []
    // How many commands each user has running
    #running = new Map<string, number>()
    // The queue's length as it was last reported, and how many of the commands waited for room
    #reportedLength = 0
    #reportedForRoom = 0
    #settings: ServerManagerSettings = DEFAULTS
    // The utilization as it was last reported
    #reportedUtilization = 0
    // The commands completed and the commands requested of late, and their numbers as last reported
    #completed = new RecentWindow<true>(THROUGHPUT_WINDOW)
    #requested = new RecentWindow<true>(THROUGHPUT_WINDOW)
    #reportedThroughput = 0
    #reportedRequested = 0
    #managerSource: RecordSource<ManagerRecord>
    // The ID of the manager's own record, and the writes of what it reports. Set by init().
    #recordId: string | undefined
    #write: DebouncedPatch<ManagerRecord> | undefined
    #isStopped = false
    #policy: ScalingDecider
    #cancelSampler: CancelTimer | undefined
    // The servers whose removal has been asked for and not yet been heard of
    #removing = new Set<string>()
    #isAdding = false

    constructor(
        context: DemoContext,
        source: RecordSource<ServerRecord>,
        records: RecordStore<ServerRecord>,
        managerSource: RecordSource<ManagerRecord>,
        policy: ScalingDecider = new ScalingPolicy(),
    ) {
        super(context, source, records)
        this.#managerSource = managerSource
        this.#policy = policy
    }

    /** How many commands wait to be run. */
    get queueLength(): number {
        return this.#queue.length
    }

    override routes(): Routes {
        return {
            [SERVER_ROUTES.add]: this.addServer,
            [SERVER_ROUTES.remove]: this.removeServer,
            // The managers' route, with this manager's key
            [fillRoute(MANAGER_ROUTES.update, { key: MANAGER_KEYS.servers })]: this.updateSettings,
        }
    }

    get scalingMode(): ServerManagerSettings['scalingMode'] {
        return this.#settings.scalingMode
    }

    /**
     * Loads the servers, then sees to its own record: one that is missing is
     * created with the defaults. What a record reports is of the run it is
     * reported in, so what it says of an earlier run is replaced.
     */
    override async init(): Promise<void> {
        await super.init()

        const { queueLength, waitingForRoom, utilization, throughput, requested } = DEFAULTS
        const record = (await this.#managerSource.find()).find(candidate => candidate.key === MANAGER_KEYS.servers)
        const { id } = record ?? (await this.#managerSource.create({ ...DEFAULTS }))
        const isStale =
            record &&
            (record.queueLength !== queueLength ||
                record.waitingForRoom !== waitingForRoom ||
                record.utilization !== utilization ||
                record.throughput !== throughput ||
                record.requested !== requested)

        if (isStale)
            await this.#managerSource.patch(id, { queueLength, waitingForRoom, utilization, throughput, requested })

        this.#recordId = id
        this.#write = debouncePatch<ManagerRecord>(data => this.#managerSource.patch(id, data), WRITE_DELAY, {
            clock: this.context.clock,
            onError: error => {
                if (!this.#isStopped) console.error('ServerManager: a write of its record failed', error)
            },
        })
    }

    /**
     * Begins to listen for commands and to watch its record for its settings. With no server there
     * is nowhere for a command to run: a first one is created.
     */
    override async start(): Promise<void> {
        await super.start()

        const { events } = this.context

        this.#subscriptions.push(
            events.on('commandRequested', event => this.#request(event)),
            events.on('commandFinished', event => this.#finished(event)),
            events.on('userRemoved', event => this.#drop(queued => queued.userId === event.userId)),
        )

        const managers = useManagerStore(this.context.pinia)

        // Sync, so the settings are in force as soon as the store has them
        this.#subscriptions.push(
            watch(
                () => Object.values(managers.records).find(record => record.key === MANAGER_KEYS.servers),
                record => this.#settingsChanged(record),
                { immediate: true, flush: 'sync' },
            ),
        )

        if (this.objects.size === 0) await this.#createServer()
    }

    /** Begins to sample the load, for the utilization and the throughput to show and for automatic mode to act on. */
    override async run(): Promise<void> {
        await super.run()

        this.#cancelSampler = this.context.clock.every(SCALING_SAMPLE_INTERVAL, () => this.#sample())
    }

    /** The Demo User adds a server. Refused in automatic mode. */
    async addServer(): Promise<AddServerResult> {
        this.#requireManual()

        return this.#createServer()
    }

    /** The Demo User removes a server, at once: the commands it runs are aborted. Refused in automatic mode. */
    async removeServer(params: RouteParams): Promise<void> {
        this.#requireManual()

        const id = params.id

        if (!id || !this.records.get(id)) {
            throw new CommandError('not_found', `There is no server '${id}'`)
        }

        await this.source.remove(id)
    }

    /** The Demo User changes the settings. One left out stays as it is. */
    async updateSettings(_params: RouteParams, data: SettingsUpdate): Promise<void> {
        const changes: SettingsUpdate = {}
        const { scalingMode, maxUtilization } = data ?? {}

        if (scalingMode !== undefined) {
            if (scalingMode !== 'automatic' && scalingMode !== 'manual') {
                throw new CommandError(
                    'bad_request',
                    `The scaling mode is 'automatic' or 'manual', not '${scalingMode}'`,
                )
            }

            changes.scalingMode = scalingMode
        }

        if (maxUtilization !== undefined) {
            if (
                typeof maxUtilization !== 'number' ||
                !(maxUtilization >= MIN_MAX_UTILIZATION && maxUtilization <= MAX_MAX_UTILIZATION)
            ) {
                throw new CommandError(
                    'bad_request',
                    `The maximum utilization is a number from ${MIN_MAX_UTILIZATION} to ${MAX_MAX_UTILIZATION}`,
                )
            }

            changes.maxUtilization = maxUtilization
        }

        if (Object.keys(changes).length === 0) {
            throw new CommandError('bad_request', 'There is nothing to change')
        }

        if (!this.#recordId) throw new CommandError('not_found', 'The servers have no settings yet')

        await this.#managerSource.patch(this.#recordId, changes)
    }

    /**
     * Stops sampling and listening and drops what waits, writes what is still to
     * be written, then destroys the servers, which aborts what runs.
     */
    override async stop(): Promise<void> {
        this.#cancelSampler?.()
        this.#cancelSampler = undefined

        for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe()

        this.#drop(() => true)
        this.#running.clear()

        this.#isStopped = true
        await this.#write?.flush().catch(() => {})

        await super.stop()
    }

    /** A new server is room for what waits, and more capacity. */
    protected override recordAdded(record: ServerRecord): void {
        super.recordAdded(record)
        this.#serve()
    }

    protected override recordRemoved(record: ServerRecord): void {
        super.recordRemoved(record)
        this.#removing.delete(record.id)
    }

    protected override createObject(record: ServerRecord, options: LiveObjectOptions): VirtualServer {
        return new VirtualServer(record.id, this.records, this.source, this.context, options)
    }

    // A command joins the back of the queue, unless its user has one waiting already
    #request(event: CommandRequestedEvent): void {
        this.#requested.add(this.context.clock.now(), true)

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
    #finished({ userId, serverId, outcome }: CommandFinishedEvent): void {
        if (outcome === 'completed') this.#completed.add(this.context.clock.now(), true)

        const running = (this.#running.get(userId) ?? 0) - 1

        if (running > 0) {
            this.#running.set(userId, running)
        } else {
            this.#running.delete(userId)
        }

        // A draining server that has run its last command has nothing left to wait for
        const server = this.objects.get(serverId)

        if (server?.isDraining && !server.isDestroyed && server.activeCommands === 0) this.#remove(server.id)

        this.#serve()
    }

    // Starts what can start, and reports the queue when that changed it
    #serve(): void {
        this.#start()
        this.#reportQueue()
    }

    /**
     * Starts what waits, from the front of the queue. A command whose user has
     * its full count running waits for that user, and is passed over. The first
     * one that waits for room ends the pass: nothing behind it starts before it,
     * however small, or a large command could wait forever.
     */
    #start(): void {
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

        for (const candidate of this.#available()) {
            if (candidate.free < cost) continue
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

        this.#reportQueue()
    }

    #reportQueue(): void {
        const queueLength = this.#queue.length
        const waitingForRoom = this.#waitingForRoom().length

        if (queueLength === this.#reportedLength && waitingForRoom === this.#reportedForRoom) return

        this.#reportedLength = queueLength
        this.#reportedForRoom = waitingForRoom
        this.#write?.patch({ queueLength, waitingForRoom })
    }

    // The commands in the queue whose user could have one more running: what they wait for is room on a server
    #waitingForRoom(): CommandRequestedEvent[] {
        return this.#queue.filter(event => (this.#running.get(event.userId) ?? 0) < MAX_RUNNING_PER_USER)
    }

    // Reports the policy's average utilization, in whole percent, when it has changed
    #reportUtilization(): void {
        const utilization = Math.round(this.#policy.utilization * 100) / 100

        if (utilization === this.#reportedUtilization) return

        this.#reportedUtilization = utilization
        this.#write?.patch({ utilization })
    }

    // Reports how many commands were completed and how many were requested of late, when either has changed
    #reportThroughput(): void {
        const now = this.context.clock.now()
        const throughput = this.#completed.values(now).length
        const requested = this.#requested.values(now).length

        if (throughput === this.#reportedThroughput && requested === this.#reportedRequested) return

        this.#reportedThroughput = throughput
        this.#reportedRequested = requested
        this.#write?.patch({ throughput, requested })
    }

    // The servers that take commands: not draining, and not being removed
    #available(): VirtualServer[] {
        return [...this.objects.values()].filter(
            server => !server.isDestroyed && !server.isDraining && !this.#removing.has(server.id),
        )
    }

    async #createServer(): Promise<AddServerResult> {
        const { id } = await this.source.create({
            name: `Server ${this.#nextNumber()}`,
            capacity: SERVER_CAPACITY,
            load: 0,
            activeCommands: 0,
            isDraining: false,
        })

        return { id }
    }

    // Asks for the server's record to be removed. The server is gone once that is heard of.
    #remove(id: string): void {
        if (this.#removing.has(id)) return

        this.#removing.add(id)
        this.source.remove(id).catch(error => {
            this.#removing.delete(id)
            console.error(`ServerManager: the server ${id} could not be removed`, error)
        })
    }

    #requireManual(): void {
        if (this.#settings.scalingMode === 'automatic') {
            throw new CommandError('automatic_mode', 'In automatic mode the servers are added and removed for you')
        }
    }

    // The manager's record as the store has it now, for its settings. Without one, the defaults.
    #settingsChanged(record: ManagerRecord | undefined): void {
        const { scalingMode, maxUtilization } = record ?? DEFAULTS
        const settings = { scalingMode, maxUtilization }

        // A mode just entered waits its full time before it decides
        if (settings.scalingMode !== this.#settings.scalingMode) this.#policy.reset()

        this.#settings = settings
    }

    /**
     * The look at the servers, at each interval: the load and the capacity of
     * those that take commands, and the cost of the commands that wait for
     * room. A command that waits for its own user's running commands is not
     * demand a further server would meet. The policy's decision is acted on
     * in automatic mode only.
     */
    #sample(): void {
        const servers = this.#available()
        const decision = this.#policy.sample({
            load: servers.reduce((sum, server) => sum + server.load, 0),
            waiting: this.#waitingForRoom().reduce((sum, event) => sum + COMMAND_TYPES[event.type].cost, 0),
            capacity: servers.reduce((sum, server) => sum + server.capacity, 0),
            maxUtilization: this.#settings.maxUtilization,
        })

        this.#reportUtilization()
        this.#reportThroughput()

        if (this.#settings.scalingMode !== 'automatic') return

        // More servers than automatic mode keeps, as manual mode may leave them: the limit comes first
        if (servers.length > MAX_SERVERS) {
            this.#retireExtra(servers)
            return
        }

        if (decision === 'up') this.#scaleUp()
        if (decision === 'down') this.#scaleDown(servers)
    }

    // A server that drains is taken back before a new one is added. At the most servers, neither.
    #scaleUp(): void {
        if (this.#available().length >= MAX_SERVERS) return

        const draining = [...this.objects.values()].find(
            server => server.isDraining && !server.isDestroyed && !this.#removing.has(server.id),
        )

        if (draining) {
            draining.resume()
            this.#serve()
            return
        }

        // One server is added at a time: while the data service does not answer, a further decision adds none
        if (this.#isAdding || this.objects.size - this.#removing.size >= MAX_SERVERS) return

        this.#isAdding = true
        this.#createServer()
            .catch(error => console.error('ServerManager: a server could not be added', error))
            .finally(() => (this.#isAdding = false))
    }

    /**
     * One server goes at a time. An idle one is removed at once, the newest
     * first. With none idle, the least loaded is drained, and removed when its
     * last command ends, so that scaling down aborts nothing.
     */
    #scaleDown(servers: VirtualServer[]): void {
        const isLeaving = this.#removing.size > 0 || [...this.objects.values()].some(server => server.isDraining)

        if (isLeaving || servers.length <= MIN_SERVERS) return

        const [server] = this.#leastLoaded(servers)

        if (server) this.#retire(server)
    }

    // The servers beyond the most leave together, by the same choice as in scaling down
    #retireExtra(servers: VirtualServer[]): void {
        for (const server of this.#leastLoaded(servers).slice(0, servers.length - MAX_SERVERS)) this.#retire(server)
    }

    // The least loaded first, and of those the newest
    #leastLoaded(servers: VirtualServer[]): VirtualServer[] {
        return servers.toSorted((a, b) => a.load - b.load || this.#numberOf(b) - this.#numberOf(a))
    }

    // An idle server is removed at once. A busy one is drained, and removed when its last command ends.
    #retire(server: VirtualServer): void {
        if (server.activeCommands === 0) {
            this.#remove(server.id)
        } else {
            server.drain()
        }
    }

    #numberOf(server: VirtualServer): number {
        return serverNumber(this.records.get(server.id)?.name)
    }

    // One more than the highest number a server's name ends in
    #nextNumber(): number {
        let highest = 0

        for (const record of Object.values(this.records.records)) {
            const number = serverNumber(record.name)

            if (number > highest) highest = number
        }

        return highest + 1
    }
}
