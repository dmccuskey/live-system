import { afterEach, describe, expect, test } from 'bun:test'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { collect, createContext, until } from './test-support.ts'
import { VirtualUser } from './virtual-user.ts'

// 20 commands a minute is one every 3 s: 30 ms at the tests' time scale
const record: UserRecord = {
    id: 'u1',
    name: 'Alice',
    commandsPerMinute: 20,
    commandMix: { search: 0.2, standard: 0.5, agentic: 0.3 },
    frustration: 0,
}

let users: VirtualUser[] = []

const create = (overrides: Partial<UserRecord> = {}, random = () => 0.5) => {
    const context = createContext({ random })
    const sent = collect(context.events, 'commandRequested')
    const user = new VirtualUser({ ...record, ...overrides }, context)

    users.push(user)

    return { user, sent, context }
}

afterEach(() => {
    for (const user of users) user.destroy()
    users = []
})

describe('generating commands', () => {
    test('nothing is sent before run()', async () => {
        const { user, sent } = create()

        await user.init()
        await user.start()
        await Bun.sleep(80)

        expect(sent).toEqual([])
    })

    test('once running it keeps emitting commandRequested, as itself, each with an ID of its own', async () => {
        const { user, sent } = create()

        user.run()
        await until(() => sent.length >= 3)

        for (const event of sent) expect(event.userId).toBe('u1')
        expect(new Set(sent.map(event => event.commandId)).size).toBe(sent.length)
    })

    test('the type is drawn from the mix', async () => {
        const types = (value: number) => {
            // The delay and the type are drawn in turn: the delay always from 0.5
            let draws = 0
            const { user, sent } = create({}, () => (draws++ % 2 === 0 ? 0.5 : value))

            user.run()

            return until(() => sent.length >= 2).then(() => new Set(sent.map(event => event.type)))
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
        await Bun.sleep(300)

        // At the tests' time scale: about 2 against about 43
        expect(fast.sent.length).toBeGreaterThan(slow.sent.length * 3)
    })

    test('a rate of zero sends nothing', async () => {
        const { user, sent } = create({ commandsPerMinute: 0 })

        user.run()
        await Bun.sleep(80)

        expect(sent).toEqual([])
    })

    test('a refused command does not stop the next', async () => {
        const { user, sent, context } = create()

        context.events.on('commandRequested', event => context.events.emit('commandRefused', { ...event, reason: 'queue_full' }))
        user.run()
        await until(() => sent.length >= 3)
    })
})

describe('destroying a user', () => {
    test('it sends nothing more', async () => {
        const { user, sent } = create()

        user.run()
        await until(() => sent.length >= 1)
        user.destroy()

        const count = sent.length
        await Bun.sleep(120)

        expect(sent).toHaveLength(count)
    })

    test('a user destroyed before run() never starts', async () => {
        const { user, sent } = create()

        user.destroy()
        user.run()
        await Bun.sleep(80)

        expect(sent).toEqual([])
    })
})
