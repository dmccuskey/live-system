import { afterEach, describe, expect, test } from 'bun:test'
import { COMMAND_TYPES } from '@virtual-infrastructure/protocol/servers/servers.constants'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { MemoryRecordSource } from 'live-system/core'
import { useServerStore } from './stores.ts'
import { advanceUntil, collect, createContext, finishedEvents } from './test-support.ts'
import { VirtualServer } from './virtual-server.ts'

const record: ServerRecord = { id: 's1', name: 'Server 1', capacity: 10, load: 0, activeCommands: 0, isDraining: false }

/** A record source that keeps what it was asked to patch. */
class RecordingSource extends MemoryRecordSource<ServerRecord> {
    patches: Partial<ServerRecord>[] = []

    override async patch(id: string, data: Partial<ServerRecord>): Promise<ServerRecord> {
        this.patches.push(data)

        return super.patch(id, data)
    }
}

let servers: VirtualServer[] = []

const create = (overrides: Partial<ServerRecord> = {}) => {
    const source = new RecordingSource([{ ...record, ...overrides }])
    const context = createContext()
    const records = useServerStore(context.pinia)

    records.set({ ...record, ...overrides })

    const server = new VirtualServer(record.id, records, source, context)

    servers.push(server)

    return { server, source, context, clock: context.clock, events: finishedEvents(context), records }
}

const command = (id: string, type: 'search' | 'standard' | 'agentic' = 'search') => ({ id, userId: 'u1', type })

afterEach(() => {
    for (const server of servers) server.destroy()
    servers = []
})

describe('taking a command', () => {
    test('a command taken adds its cost to the load', () => {
        const { server } = create()

        expect(server.take(command('c1', 'agentic'))).toBe(true)
        expect(server.take(command('c2', 'standard'))).toBe(true)

        expect(server.load).toBe(COMMAND_TYPES.agentic.cost + COMMAND_TYPES.standard.cost)
        expect(server.free).toBe(10 - server.load)
        expect(server.activeCommands).toBe(2)
    })

    test('a command taken is announced with commandStarted', () => {
        const { server, context } = create()
        const started = collect(context.events, 'commandStarted')

        server.take(command('c1', 'standard'))

        expect(started).toEqual([{ commandId: 'c1', userId: 'u1', serverId: 's1', type: 'standard' }])
    })

    test('a command not taken is not announced', () => {
        const { server, context } = create({ capacity: 1 })
        const started = collect(context.events, 'commandStarted')

        server.take(command('c1', 'agentic'))

        expect(started).toEqual([])
    })

    test('a command that does not fit is refused, and the load stays within the capacity', () => {
        const { server } = create({ capacity: 5 })

        expect(server.take(command('c1', 'agentic'))).toBe(true)
        expect(server.take(command('c2', 'standard'))).toBe(false)
        expect(server.take(command('c3', 'search'))).toBe(true)
        expect(server.take(command('c4', 'search'))).toBe(false)

        expect(server.load).toBe(5)
        expect(server.activeCommands).toBe(2)
    })

    test('the capacity is what its record has in the store now, not what it was created with', () => {
        const { server, records } = create({ capacity: 1 })

        expect(server.take(command('c1', 'agentic'))).toBe(false)

        records.set({ ...record, capacity: 10 })

        expect(server.capacity).toBe(10)
        expect(server.take(command('c1', 'agentic'))).toBe(true)
        expect(server.free).toBe(10 - COMMAND_TYPES.agentic.cost)
    })

    test('a server whose record has gone from the store has no capacity and takes nothing', () => {
        const { server, records } = create()

        records.remove(record.id)

        expect(server.capacity).toBe(0)
        expect(server.take(command('c1', 'search'))).toBe(false)
    })

    test('a command already running is not taken again', () => {
        const { server } = create()

        expect(server.take(command('c1'))).toBe(true)
        expect(server.take(command('c1'))).toBe(false)
        expect(server.load).toBe(COMMAND_TYPES.search.cost)
    })

    test('a destroyed server takes nothing', () => {
        const { server } = create()

        server.destroy()

        expect(server.take(command('c1'))).toBe(false)
    })
})

describe('finishing a command', () => {
    test('a command finishes after its duration, frees its units and emits commandFinished', async () => {
        const { server, events, clock } = create()

        server.take(command('c1', 'search'))
        expect(events).toEqual([])

        await advanceUntil(clock, () => events.length === 1)

        expect(events[0]).toEqual({
            commandId: 'c1',
            userId: 'u1',
            serverId: 's1',
            type: 'search',
            outcome: 'completed',
        })
        expect(server.load).toBe(0)
        expect(server.activeCommands).toBe(0)
    })

    test('a longer command outlasts a shorter one', async () => {
        const { server, events, clock } = create()

        server.take(command('long', 'standard'))
        server.take(command('short', 'search'))

        await advanceUntil(clock, () => events.length === 1)

        expect(events[0]?.commandId).toBe('short')
        expect(server.load).toBe(COMMAND_TYPES.standard.cost)

        await advanceUntil(clock, () => events.length === 2)

        expect(events[1]?.commandId).toBe('long')
    })

    test('the room a finished command leaves can be taken', async () => {
        const { server, events, clock } = create({ capacity: 1 })

        server.take(command('c1'))
        expect(server.take(command('c2'))).toBe(false)

        await advanceUntil(clock, () => events.length === 1)

        expect(server.take(command('c2'))).toBe(true)
    })
})

describe('the record', () => {
    test('the load and the count of active commands are written to the record', async () => {
        const { server, source, clock } = create()

        server.take(command('c1', 'agentic'))
        server.take(command('c2', 'agentic'))

        await advanceUntil(clock, () => source.patches.length > 0)

        expect(await source.get('s1')).toMatchObject({ load: 8, activeCommands: 2 })
    })

    test('changes close together are written as one', async () => {
        const { server, source, clock } = create()

        server.take(command('c1', 'agentic'))
        server.take(command('c2', 'agentic'))
        server.take(command('c3', 'standard'))
        await clock.advance(100 * 5)

        expect(source.patches).toEqual([{ load: 10, activeCommands: 3 }])
    })

    test('the record is back at zero once every command has finished', async () => {
        const { server, source, events, clock } = create()

        server.take(command('c1'))
        server.take(command('c2'))

        await advanceUntil(clock, () => events.length === 2)
        await advanceUntil(clock, () => source.patches.at(-1)?.load === 0)

        expect(await source.get('s1')).toMatchObject({ load: 0, activeCommands: 0 })
    })

    test('init() clears what the record says of an earlier run', async () => {
        const { server, source } = create({ load: 6, activeCommands: 2 })

        await server.init()

        expect(await source.get('s1')).toMatchObject({ load: 0, activeCommands: 0 })
    })

    test('init() keeps a command taken before it', async () => {
        const { server, source } = create({ load: 6, activeCommands: 2 })

        server.take(command('c1', 'agentic'))
        await server.init()

        expect(await source.get('s1')).toMatchObject({ load: 4, activeCommands: 1 })
    })

    test('init() writes nothing to a record that is already clear', async () => {
        const { server, source } = create()

        await server.init()

        expect(source.patches).toEqual([])
    })
})

describe('draining', () => {
    test('a draining server takes no new command', () => {
        const { server } = create()

        server.drain()

        expect(server.isDraining).toBe(true)
        expect(server.take(command('c1'))).toBe(false)
        expect(server.load).toBe(0)
    })

    test('what it runs goes on to its end', async () => {
        const { server, events, clock } = create()

        server.take(command('c1', 'search'))
        server.drain()
        await advanceUntil(clock, () => events.length === 1)

        expect(events[0]).toMatchObject({ commandId: 'c1', outcome: 'completed' })
        expect(server.activeCommands).toBe(0)
    })

    test('resume() ends it: the server takes commands again', () => {
        const { server } = create()

        server.drain()
        server.resume()

        expect(server.isDraining).toBe(false)
        expect(server.take(command('c1'))).toBe(true)
    })

    test('the record says that the server drains, and that it no longer does', async () => {
        const { server, source, clock } = create()

        server.drain()
        await advanceUntil(clock, () => source.patches.length === 1)
        expect(await source.get('s1')).toMatchObject({ isDraining: true })

        server.resume()
        await advanceUntil(clock, () => source.patches.length === 2)
        expect(await source.get('s1')).toMatchObject({ isDraining: false })
    })

    test('draining twice is written once', async () => {
        const { server, source, clock } = create()

        server.drain()
        await advanceUntil(clock, () => source.patches.length === 1)
        server.drain()
        await clock.advance(100 * 5)

        expect(source.patches).toEqual([{ isDraining: true }])
    })

    test('init() clears the draining an earlier run left', async () => {
        const { server, source } = create({ isDraining: true })

        await server.init()

        expect(server.isDraining).toBe(false)
        expect(await source.get('s1')).toMatchObject({ isDraining: false })
        expect(server.take(command('c1'))).toBe(true)
    })

    test('a destroyed server is not drained', async () => {
        const { server, source, clock } = create()

        server.destroy()
        server.drain()
        await clock.advance(100 * 5)

        expect(server.isDraining).toBe(false)
        expect(source.patches).toEqual([])
    })
})

describe('destroying a server', () => {
    test('its running commands are aborted, each with an event', () => {
        const { server, events } = create()

        server.take(command('c1', 'agentic'))
        server.take(command('c2', 'search'))
        server.destroy()

        expect(events.map(event => [event.commandId, event.outcome])).toEqual([
            ['c1', 'aborted'],
            ['c2', 'aborted'],
        ])
        expect(server.load).toBe(0)
        expect(server.activeCommands).toBe(0)
    })

    test('nothing finishes and nothing is written afterwards', async () => {
        const { server, source, events, clock } = create()

        server.take(command('c1', 'search'))
        server.destroy()
        await clock.advance(COMMAND_TYPES.search.duration * 2)

        expect(events).toHaveLength(1)
        expect(source.patches).toEqual([])
    })
})
