import { afterEach, describe, expect, test } from 'bun:test'
import { STATUS_KEYS } from '@virtual-infrastructure/protocol/status/status.constants'
import type { StatusRecord } from '@virtual-infrastructure/protocol/status/status.record'
import { defineRecordStore, MemoryRecordSource } from 'live-system/core'
import type { LiveSystem } from 'live-system/core'
import { createPinia } from 'pinia'
import type { DemoContext } from './context.ts'
import { StatusManager } from './status-manager.ts'
import { bootSystem, TIME_SCALE, until } from './test-support.ts'

/** A record source that keeps what it was asked to patch. */
class RecordingSource extends MemoryRecordSource<StatusRecord> {
    patches: Partial<StatusRecord>[] = []

    override async patch(id: string, data: Partial<StatusRecord>): Promise<StatusRecord> {
        this.patches.push(data)

        return super.patch(id, data)
    }
}

let systems: LiveSystem<DemoContext>[] = []

const boot = async (records: StatusRecord[] = []) => {
    const source = new RecordingSource(records)
    const booted = await bootSystem<[StatusManager]>([
        context => new StatusManager(context, source, defineRecordStore<StatusRecord>('status')(createPinia())),
    ])

    systems.push(booted.system)

    const queue = (length: number) => booted.context.events.emit('servers.queueChanged', { length })
    const utilization = (value: number) => booted.context.events.emit('servers.utilizationChanged', { utilization: value })

    return { ...booted, source, queue, utilization }
}

afterEach(async () => {
    for (const system of systems) await system.shutdown()
    systems = []
})

describe('the start', () => {
    test('with no status record, one is created with nothing waiting', async () => {
        const { source } = await boot()

        expect(await source.find()).toEqual([{ id: expect.any(String), key: STATUS_KEYS.servers, queueLength: 0, utilization: 0 }])
    })

    test('what the record says of an earlier run is cleared', async () => {
        const { source } = await boot([{ id: 'x1', key: STATUS_KEYS.servers, queueLength: 4, utilization: 0.8 }])

        expect(await source.find()).toEqual([{ id: 'x1', key: STATUS_KEYS.servers, queueLength: 0, utilization: 0 }])
    })

    test('a record that is already clear is not written', async () => {
        const { source } = await boot([{ id: 'x1', key: STATUS_KEYS.servers, queueLength: 0, utilization: 0 }])

        expect(source.patches).toEqual([])
    })
})

describe('the records', () => {
    test('a status with another key is left alone, and the server manager\'s is created beside it', async () => {
        const other = { id: 'x2', key: 'users', queueLength: 9, utilization: 0.9 }
        const { source, queue } = await boot([other])

        queue(1)
        await until(() => source.patches.length > 0)

        expect(await source.find()).toEqual([other, { id: expect.any(String), key: 'servers', queueLength: 1, utilization: 0 }])
    })
})

describe('a servers.queueChanged event', () => {
    test('the length is written to the record', async () => {
        const { source, queue } = await boot()

        queue(3)
        await until(() => source.patches.length > 0)

        expect(await source.find()).toMatchObject([{ key: STATUS_KEYS.servers, queueLength: 3, utilization: 0 }])
    })

    test('a record from an earlier run is written by the ID it has', async () => {
        const { source, queue } = await boot([{ id: 'x1', key: STATUS_KEYS.servers, queueLength: 0, utilization: 0 }])

        queue(2)
        await until(() => source.patches.length > 0)

        expect(await source.find()).toEqual([{ id: 'x1', key: STATUS_KEYS.servers, queueLength: 2, utilization: 0 }])
    })

    test('changes close together are written as one, the last', async () => {
        const { source, queue } = await boot()

        queue(1)
        queue(2)
        queue(1)
        await Bun.sleep(100 * TIME_SCALE * 5)

        expect(source.patches).toEqual([{ queueLength: 1 }])
    })
})

describe('a servers.utilizationChanged event', () => {
    test('the utilization is written to the record', async () => {
        const { source, utilization } = await boot()

        utilization(0.4)
        await until(() => source.patches.length > 0)

        expect(await source.find()).toMatchObject([{ queueLength: 0, utilization: 0.4 }])
    })

    test('a change of the queue close to it is the same write', async () => {
        const { source, queue, utilization } = await boot()

        utilization(1)
        queue(2)
        await Bun.sleep(100 * TIME_SCALE * 5)

        expect(source.patches).toEqual([{ utilization: 1, queueLength: 2 }])
    })
})

describe('stopping', () => {
    test('what is still to be written is written, and later events are not', async () => {
        const { system, source, queue } = await boot()

        queue(2)
        await system.shutdown()
        queue(5)
        await Bun.sleep(100 * TIME_SCALE * 3)

        expect(source.patches).toEqual([{ queueLength: 2 }])
    })
})
