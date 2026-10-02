// feathers-connect and LiveSystem do not depend on each other: here, where both
// are used, is the check that a Feathers record source is a LiveSystem one.
import { expect, test } from 'bun:test'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/record'
import { SERVICES } from '@virtual-infrastructure/protocol/services'
import { FeathersConnection } from 'feathers-connect'
import type { RecordSource } from 'live-system/core'

test('a Feathers record source satisfies RecordSource', () => {
    const connection = new FeathersConnection({ url: 'http://localhost:3030' })
    // The assignment is the test: it fails the typecheck when the two drift apart
    const source: RecordSource<UserRecord> = connection.recordSource<UserRecord>(SERVICES.users)

    for (const method of ['find', 'get', 'create', 'update', 'patch', 'remove'] as const) {
        expect(source[method]).toBeFunction()
    }
    for (const method of ['onCreated', 'onUpdated', 'onPatched', 'onRemoved'] as const) {
        expect(source[method]).toBeFunction()
    }
})
