import { describe, expect, test } from 'bun:test'
import { DataManager, defineRecordStore, LiveSystem, MemoryRecordSource } from 'live-system/core'
import { WebStartup } from 'live-system/web'
import type { SystemPhase } from 'live-system/web'
import { createPinia } from 'pinia'
import { nextTick, watch } from 'vue'

interface Item {
    id: string
    name: string
}

class ItemManager extends DataManager<Item> {}

// A source whose find() waits until the test lets it through
class GatedSource extends MemoryRecordSource<Item> {
    gate: Promise<void> | undefined
    failure: Error | undefined

    override async find(): Promise<Item[]> {
        await this.gate
        if (this.failure) throw this.failure
        return super.find()
    }
}

// A web app's system: no router, one data manager, and a log of what happened
function webApp(source = new GatedSource([{ id: 'a', name: 'first' }])) {
    const log: string[] = []
    const store = defineRecordStore<Item>('items')(createPinia())
    const options = {
        context: undefined,
        connect: async () => void log.push('connect'),
        disconnect: async () => void log.push('disconnect')
    }
    const system = new LiveSystem<unknown>(options)
    system.addManager(context => new ItemManager(context, source, store))

    return { log, store, source, options, system, startup: new WebStartup(system) }
}

describe('WebStartup', () => {
    test('is created until it is started', () => {
        const { startup, log } = webApp()

        expect(startup.status).toEqual({ phase: 'created', error: undefined })
        expect(log).toEqual([])
    })

    test('is starting while the managers load, then running with the records in the store', async () => {
        const { startup, source, store, log } = webApp()
        let open = () => {}
        source.gate = new Promise(resolve => (open = resolve))

        const started = startup.start()

        expect(startup.status.phase).toBe('starting')
        expect(store.records).toEqual({})

        open()
        await started

        expect(startup.status).toEqual({ phase: 'running', error: undefined })
        expect(store.records).toEqual({ a: { id: 'a', name: 'first' } })
        expect(log).toEqual(['connect'])
    })

    test('the status is reactive', async () => {
        const { startup } = webApp()
        const phases: SystemPhase[] = []
        watch(
            () => startup.status.phase,
            phase => phases.push(phase),
            { flush: 'sync' }
        )

        await startup.start()
        await startup.stop()
        await nextTick()

        expect(phases).toEqual(['starting', 'running', 'stopped'])
    })

    test('a failed connection is reported in the status, not thrown', async () => {
        const { startup, options, store } = webApp()
        const error = new Error('No data service')
        options.connect = async () => {
            throw error
        }

        await startup.start()

        expect(startup.status).toEqual({ phase: 'failed', error })
        expect(store.records).toEqual({})
    })

    test('a failed load is reported in the status, and the system is disconnected', async () => {
        const { startup, source, log } = webApp()
        source.failure = new Error('No records')

        await startup.start()

        expect(startup.status.phase).toBe('failed')
        expect(startup.status.error).toBe(source.failure)
        expect(log).toEqual(['connect', 'disconnect'])
    })

    test('the error is kept as it was thrown, not made reactive', async () => {
        const { startup, source } = webApp()
        source.failure = new Error('No records')

        await startup.start()

        expect(startup.status.error).toBe(source.failure)
    })

    test('start() can only be called once', async () => {
        const { startup } = webApp()
        await startup.start()

        expect(startup.start()).rejects.toThrow('start() can only be called once')
        expect(startup.status.phase).toBe('running')
    })

    test('stop() shuts the system down', async () => {
        const { startup, log } = webApp()
        await startup.start()

        await startup.stop()
        await startup.stop()

        expect(startup.status).toEqual({ phase: 'stopped', error: undefined })
        expect(log).toEqual(['connect', 'disconnect'])
    })

    test('stop() clears the error of a failed startup', async () => {
        const { startup, source } = webApp()
        source.failure = new Error('No records')
        await startup.start()

        await startup.stop()

        expect(startup.status).toEqual({ phase: 'stopped', error: undefined })
    })

    test('a startup stopped while starting ends up stopped', async () => {
        const { startup, source, log } = webApp()
        let open = () => {}
        source.gate = new Promise(resolve => (open = resolve))

        const started = startup.start()
        const stopped = startup.stop()
        open()
        await Promise.all([started, stopped])

        expect(startup.status.phase).toBe('stopped')
        expect(log).toEqual(['connect', 'disconnect'])
    })

    test('a failed shutdown is passed on, and the status is stopped', async () => {
        const { startup, options } = webApp()
        options.disconnect = async () => {
            throw new Error('Cannot disconnect')
        }
        await startup.start()

        expect(startup.stop()).rejects.toThrow('Cannot disconnect')
        await startup.stop().catch(() => {})

        expect(startup.status.phase).toBe('stopped')
    })
})
