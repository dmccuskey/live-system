import { describe, expect, test } from 'bun:test'
import { CommandError } from 'live-system/core'
import type { Command } from 'live-system/core'
import { createCommandSender } from './command-sender.ts'

const command: Command = { route: 'users/add', data: undefined }

const accepting = { send: async () => ({ status: 'accepted' as const }) }
const failing = (error: unknown) => ({
    send: async (): Promise<never> => {
        throw error
    },
})

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('createCommandSender', () => {
    test('passes the command to the client', async () => {
        const sent: Command[] = []
        const sender = createCommandSender({
            send: async (given: Command) => {
                sent.push(given)

                return { status: 'accepted' as const }
            },
        })

        await sender.send(command)

        expect(sent).toEqual([command])
    })

    test('resolves with true for an accepted command, and has no error', async () => {
        const sender = createCommandSender(accepting)

        expect(await sender.send(command)).toBe(true)
        expect(sender.error.value).toBeUndefined()
    })

    test('resolves with false for a failed command, and keeps its message', async () => {
        const sender = createCommandSender(
            failing(new CommandError('automatic_mode', 'Servers are scaled automatically')),
        )

        expect(await sender.send(command)).toBe(false)
        expect(sender.error.value).toBe('Servers are scaled automatically')

        sender.dismiss()
    })

    test('keeps what was thrown as text when it is no CommandError', async () => {
        const sender = createCommandSender(failing('odd'))

        await sender.send(command)

        expect(sender.error.value).toBe('odd')

        sender.dismiss()
    })

    test('dismiss() clears the error', async () => {
        const sender = createCommandSender(failing(new CommandError('internal', 'Failed')))

        await sender.send(command)
        sender.dismiss()

        expect(sender.error.value).toBeUndefined()
    })

    test('the error clears itself when its time is up', async () => {
        const sender = createCommandSender(failing(new CommandError('internal', 'Failed')), 20)

        await sender.send(command)
        expect(sender.error.value).toBe('Failed')

        await wait(40)
        expect(sender.error.value).toBeUndefined()
    })

    test('a later failure replaces the error and gets its full time', async () => {
        let message = 'First'
        const sender = createCommandSender(
            {
                send: async (): Promise<never> => {
                    throw new CommandError('internal', message)
                },
            },
            40,
        )

        await sender.send(command)
        await wait(25)
        message = 'Second'
        await sender.send(command)
        await wait(25)

        // The first failure's time is up, the second's is not
        expect(sender.error.value).toBe('Second')

        sender.dismiss()
    })

    test('an accepted command leaves an earlier error in place', async () => {
        let fail = true
        const sender = createCommandSender({
            send: async () => {
                if (fail) throw new CommandError('internal', 'Failed')

                return { status: 'accepted' as const }
            },
        })

        await sender.send(command)
        fail = false
        await sender.send(command)

        expect(sender.error.value).toBe('Failed')

        sender.dismiss()
    })
})
