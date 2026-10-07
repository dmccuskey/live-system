import { afterEach, describe, expect, test } from 'bun:test'
import type { CommandRequestedEvent } from '@virtual-infrastructure/protocol/events'
import {
    FRUSTRATION_ABORTED,
    FRUSTRATION_PER_SECOND_QUEUED,
    FRUSTRATION_REFUSED,
    FRUSTRATION_RELIEF,
} from '@virtual-infrastructure/protocol/users/users.constants'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { MemoryRecordSource } from 'live-system/core'
import { advanceUntil, collect, createContext } from './test-support.ts'
import { VirtualUser } from './virtual-user.ts'

// 20 commands a minute is one every 3 s
const record: UserRecord = {
    id: 'u1',
    name: 'Alice',
    commandsPerMinute: 20,
    commandMix: { search: 0.2, standard: 0.5, agentic: 0.3 },
    frustration: 0,
}

/** A record source that keeps what it was asked to patch. */
class RecordingSource extends MemoryRecordSource<UserRecord> {
    patches: Partial<UserRecord>[] = []

    override async patch(id: string, data: Partial<UserRecord>): Promise<UserRecord> {
        this.patches.push(data)

        return super.patch(id, data)
    }
}

let users: VirtualUser[] = []

const create = (overrides: Partial<UserRecord> = {}, random = () => 0.5) => {
    const context = createContext({ random })
    const source = new RecordingSource([{ ...record, ...overrides }])
    const sent = collect(context.events, 'commandRequested')
    const user = new VirtualUser({ ...record, ...overrides }, source, context)

    users.push(user)

    return { user, sent, context, clock: context.clock, source }
}

// A user that listens but sends nothing of its own: the tests play the servers' part
const listening = async (overrides: Partial<UserRecord> = {}) => {
    const created = create({ commandsPerMinute: 0, ...overrides })

    await created.user.init()
    await created.user.start()

    return created
}

const command = (
    commandId: string,
    type: CommandRequestedEvent['type'] = 'search',
    userId = 'u1',
): CommandRequestedEvent => ({
    commandId,
    userId,
    type,
})

afterEach(() => {
    for (const user of users) user.destroy()
    users = []
})

describe('generating commands', () => {
    test('nothing is sent before run()', async () => {
        const { user, sent, clock } = create()

        await user.init()
        await user.start()
        await clock.advance(8_000)

        expect(sent).toEqual([])
    })

    test('once running it keeps emitting commandRequested, as itself, each with an ID of its own', async () => {
        const { user, sent, clock } = create()

        user.run()
        await advanceUntil(clock, () => sent.length >= 3)

        for (const event of sent) expect(event.userId).toBe('u1')
        expect(new Set(sent.map(event => event.commandId)).size).toBe(sent.length)
    })

    test('the type is drawn from the mix', async () => {
        const types = (value: number) => {
            // The delay and the type are drawn in turn: the delay always from 0.5
            let draws = 0
            const { user, sent, clock } = create({}, () => (draws++ % 2 === 0 ? 0.5 : value))

            user.run()

            return advanceUntil(clock, () => sent.length >= 2).then(() => new Set(sent.map(event => event.type)))
        }

        expect(await types(0.1)).toEqual(new Set(['search']))
        expect(await types(0.5)).toEqual(new Set(['standard']))
        expect(await types(0.9)).toEqual(new Set(['agentic']))
    })

    test('a higher rate sends more', async () => {
        const slow = create({ commandsPerMinute: 4 })
        const fast = create({ commandsPerMinute: 60 })

        slow.user.run()
        fast.user.run()
        await Promise.all([slow.clock.advance(30_000), fast.clock.advance(30_000)])

        // In 30 s: about 2 against about 43
        expect(fast.sent.length).toBeGreaterThan(slow.sent.length * 3)
    })

    test('a rate of zero sends nothing', async () => {
        const { user, sent, clock } = create({ commandsPerMinute: 0 })

        user.run()
        await clock.advance(8_000)

        expect(sent).toEqual([])
    })

    test('a refused command does not stop the next', async () => {
        const { user, sent, context, clock } = create()

        context.events.on('commandRequested', event =>
            context.events.emit('commandRefused', { ...event, reason: 'queue_full' }),
        )
        user.run()
        await advanceUntil(clock, () => sent.length >= 3)
    })
})

describe('destroying a user', () => {
    test('it sends nothing more', async () => {
        const { user, sent, clock } = create()

        user.run()
        await advanceUntil(clock, () => sent.length >= 1)
        user.destroy()

        const count = sent.length
        await clock.advance(12_000)

        expect(sent).toHaveLength(count)
    })

    test('a user destroyed before run() never starts', async () => {
        const { user, sent, clock } = create()

        user.destroy()
        user.run()
        await clock.advance(8_000)

        expect(sent).toEqual([])
    })
})

describe('frustration', () => {
    test('a refusal for a full queue adds its bump', async () => {
        const { user, context } = await listening()

        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })
        context.events.emit('commandRefused', { ...command('c2'), reason: 'queue_full' })

        expect(user.frustration).toBeCloseTo(2 * FRUSTRATION_REFUSED)
    })

    test('a dropped command counts as nothing, and neither does its wait', async () => {
        const { user, context, clock } = await listening()

        context.events.emit('commandQueued', command('c1'))
        await clock.advance(3_000)
        context.events.emit('commandRefused', { ...command('c1'), reason: 'dropped' })

        expect(user.frustration).toBe(0)
    })

    test('a command taken at once adds nothing', async () => {
        const { user, context } = await listening()

        context.events.emit('commandStarted', { ...command('c1'), serverId: 's1' })

        expect(user.frustration).toBe(0)
    })

    test('a wait in the queue adds more the longer it was', async () => {
        const { user, context, clock } = await listening()

        context.events.emit('commandQueued', command('c1'))
        await clock.advance(5_000)
        context.events.emit('commandStarted', { ...command('c1'), serverId: 's1' })

        const short = user.frustration

        expect(short).toBeCloseTo(5 * FRUSTRATION_PER_SECOND_QUEUED)

        context.events.emit('commandQueued', command('c2'))
        await clock.advance(15_000)
        context.events.emit('commandStarted', { ...command('c2'), serverId: 's1' })

        expect(user.frustration - short).toBeCloseTo(15 * FRUSTRATION_PER_SECOND_QUEUED)
    })

    test('nothing is added while a command still waits', async () => {
        const { user, context, clock } = await listening()

        context.events.emit('commandQueued', command('c1'))
        await clock.advance(3_000)

        expect(user.frustration).toBe(0)
    })

    test('an abort just after the start weighs about as much as a refusal', async () => {
        const { user, context } = await listening()

        context.events.emit('commandStarted', { ...command('c1', 'agentic'), serverId: 's1' })
        context.events.emit('commandFinished', { ...command('c1', 'agentic'), serverId: 's1', outcome: 'aborted' })

        expect(user.frustration).toBeGreaterThanOrEqual(FRUSTRATION_REFUSED)
        expect(user.frustration).toBeLessThan(FRUSTRATION_REFUSED + FRUSTRATION_ABORTED * 0.2)
    })

    test('an abort weighs more the longer the command had run', async () => {
        const { user, context, clock } = await listening()

        // A standard command runs for 5 s: aborted after 4 of them
        context.events.emit('commandStarted', { ...command('c1', 'standard'), serverId: 's1' })
        await clock.advance(4_000)
        context.events.emit('commandFinished', { ...command('c1', 'standard'), serverId: 's1', outcome: 'aborted' })

        expect(user.frustration).toBeCloseTo(FRUSTRATION_REFUSED + FRUSTRATION_ABORTED * 0.8)
    })

    test('a completed command relieves it', async () => {
        const { user, context } = await listening()

        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })
        context.events.emit('commandStarted', { ...command('c2'), serverId: 's1' })
        context.events.emit('commandFinished', { ...command('c2'), serverId: 's1', outcome: 'completed' })

        expect(user.frustration).toBeCloseTo(FRUSTRATION_REFUSED * FRUSTRATION_RELIEF)
    })

    test('time alone does not reduce it', async () => {
        const { user, context, clock } = await listening()

        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })
        await clock.advance(10_000)

        expect(user.frustration).toBeCloseTo(FRUSTRATION_REFUSED)
    })

    test('it never exceeds 1', async () => {
        const { user, context } = await listening()

        for (let number = 0; number < 30; number++) {
            context.events.emit('commandRefused', { ...command(`c${number}`), reason: 'queue_full' })
        }

        expect(user.frustration).toBe(1)
    })

    test("another user's commands do not count", async () => {
        const { user, context } = await listening()

        context.events.emit('commandRefused', { ...command('c1', 'search', 'u2'), reason: 'queue_full' })
        context.events.emit('commandFinished', { ...command('c2', 'search', 'u2'), serverId: 's1', outcome: 'aborted' })

        expect(user.frustration).toBe(0)
    })

    test('nothing counts before start()', async () => {
        const { user, context } = create({ commandsPerMinute: 0 })

        await user.init()
        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })

        expect(user.frustration).toBe(0)
    })

    test('it is written to the record, several changes as one', async () => {
        const { context, source, clock } = await listening()

        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })
        context.events.emit('commandRefused', { ...command('c2'), reason: 'queue_full' })
        await advanceUntil(clock, () => source.patches.length > 0)

        expect(source.patches).toHaveLength(1)
        expect(source.patches[0]?.frustration).toBeCloseTo(2 * FRUSTRATION_REFUSED)
    })

    test('init() clears the frustration of an earlier run', async () => {
        const { user, source } = create({ commandsPerMinute: 0, frustration: 0.6 })

        await user.init()

        expect(user.frustration).toBe(0)
        expect(source.patches).toEqual([{ frustration: 0 }])
    })

    test('init() writes nothing when there is nothing to clear', async () => {
        const { user, source } = create({ commandsPerMinute: 0 })

        await user.init()

        expect(source.patches).toEqual([])
    })

    test('a destroyed user counts nothing more and writes nothing', async () => {
        const { user, context, source, clock } = await listening()

        context.events.emit('commandRefused', { ...command('c1'), reason: 'queue_full' })
        user.destroy()
        context.events.emit('commandRefused', { ...command('c2'), reason: 'queue_full' })
        await clock.advance(3_000)

        expect(user.frustration).toBeCloseTo(FRUSTRATION_REFUSED)
        expect(source.patches).toEqual([])
    })
})
