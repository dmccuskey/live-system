import { describe, expect, test } from 'bun:test'
import { CommandError, fillRoute } from 'live-system/core'

describe('fillRoute', () => {
    test('fills the parameters of a pattern', () => {
        expect(fillRoute('server/:id/restart', { id: '42' })).toBe('server/42/restart')
        expect(fillRoute('user/:user/server/:server', { user: 'ann', server: 7 })).toBe('user/ann/server/7')
    })

    test('leaves a pattern without parameters as it is', () => {
        expect(fillRoute('server/list')).toBe('server/list')
    })

    test('throws on a missing parameter', () => {
        expect(() => fillRoute('server/:id/restart', {})).toThrow("needs the parameter 'id'")
    })

    test('throws on an empty parameter', () => {
        expect(() => fillRoute('server/:id/restart', { id: '' })).toThrow("needs the parameter 'id'")
    })

    test('throws on a parameter that holds a slash', () => {
        expect(() => fillRoute('server/:id/restart', { id: 'a/b' })).toThrow("cannot hold a '/'")
    })
})

describe('CommandError', () => {
    test('has a name, a message and a code', () => {
        const error = new CommandError('busy', 'The server is busy')

        expect(error).toBeInstanceOf(Error)
        expect(error.name).toBe('CommandError')
        expect(error.message).toBe('The server is busy')
        expect(error.code).toBe('busy')
    })

    test('serializes to a plain object', () => {
        const error = new CommandError('busy', 'The server is busy', 'ServerBusy')

        expect(JSON.parse(JSON.stringify(error))).toEqual({
            name: 'ServerBusy',
            message: 'The server is busy',
            code: 'busy'
        })
    })

    test('reports anything else that was thrown as internal', () => {
        expect(CommandError.info(new TypeError('no such thing'))).toEqual({
            name: 'TypeError',
            message: 'no such thing',
            code: 'internal'
        })
        expect(CommandError.info('plain text')).toEqual({ name: 'Error', message: 'plain text', code: 'internal' })
    })
})
