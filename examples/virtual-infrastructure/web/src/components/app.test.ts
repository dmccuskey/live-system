import { describe, expect, test } from 'bun:test'
import { mount } from '@vue/test-utils'
import { createAddUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import { nextTick } from 'vue'
import { useManagerStore } from '../stores.ts'
import { createTestApp, managerRecord, until } from '../test-support.ts'
import App from './App.vue'
import SystemStatus from './SystemStatus.vue'

const exists = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.find(`[data-test="${name}"]`).exists()

describe('App', () => {
    test.each(['created', 'starting'] as const)('shows the loading screen while %s', phase => {
        const { status, global } = createTestApp()

        status.phase = phase

        const wrapper = mount(App, { global })

        expect(exists(wrapper, 'loading')).toBe(true)
        expect(exists(wrapper, 'add-user')).toBe(false)
        expect(exists(wrapper, 'utilization')).toBe(false)
    })

    test('shows why the startup failed', () => {
        const { status, global } = createTestApp()

        status.phase = 'failed'
        status.error = new Error('Connection refused')

        const wrapper = mount(App, { global })

        expect(wrapper.get('[data-test="startup-failed"]').text()).toContain('Connection refused')
        expect(exists(wrapper, 'add-user')).toBe(false)
    })

    test('shows the panels and the status once running', () => {
        const { global } = createTestApp()
        const wrapper = mount(App, { global })

        expect(exists(wrapper, 'loading')).toBe(false)
        expect(exists(wrapper, 'add-user')).toBe(true)
        expect(exists(wrapper, 'mode-automatic')).toBe(true)
        expect(exists(wrapper, 'utilization')).toBe(true)
    })

    test('goes from the loading screen to the panels as the status changes', async () => {
        const { status, global } = createTestApp()

        status.phase = 'starting'

        const wrapper = mount(App, { global })

        status.phase = 'running'
        await nextTick()

        expect(exists(wrapper, 'loading')).toBe(false)
        expect(exists(wrapper, 'add-user')).toBe(true)
    })

    test('says so when stopped', () => {
        const { status, global } = createTestApp()

        status.phase = 'stopped'

        expect(exists(mount(App, { global }), 'stopped')).toBe(true)
    })

    test('warns while the connection is lost, and keeps showing the panels', async () => {
        const { isConnected, global } = createTestApp()
        const wrapper = mount(App, { global })

        expect(exists(wrapper, 'disconnected')).toBe(false)

        isConnected.value = false
        await nextTick()

        expect(exists(wrapper, 'disconnected')).toBe(true)
        expect(exists(wrapper, 'add-user')).toBe(true)

        isConnected.value = true
        await nextTick()

        expect(exists(wrapper, 'disconnected')).toBe(false)
    })

    test('does not warn of the connection before the system runs', () => {
        const { status, isConnected, global } = createTestApp()

        status.phase = 'starting'
        isConnected.value = false

        expect(exists(mount(App, { global }), 'disconnected')).toBe(false)
    })

    test('shows why a command failed, until dismissed', async () => {
        const { app, global } = createTestApp(() => ({
            status: 'failed',
            error: { name: 'CommandError', message: 'Servers are scaled automatically', code: 'automatic_mode' },
        }))
        const wrapper = mount(App, { global })

        expect(exists(wrapper, 'command-error')).toBe(false)

        await app.commands.send(createAddUserCommand())
        await nextTick()

        expect(wrapper.get('[data-test="command-error"]').text()).toContain('Servers are scaled automatically')

        await wrapper.get('[data-test="command-error"] button').trigger('click')

        expect(exists(wrapper, 'command-error')).toBe(false)
    })
})

describe('SystemStatus', () => {
    const text = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.get(`[data-test="${name}"]`).text()

    test('shows the initial status while there is no record', () => {
        const { global } = createTestApp()
        const wrapper = mount(SystemStatus, { global })

        expect(text(wrapper, 'utilization')).toBe('0%')
        expect(text(wrapper, 'queue-user')).toBe('0')
        expect(text(wrapper, 'queue-capacity')).toBe('0')

        wrapper.unmount()
    })

    test("shows the utilization and the queue of the server manager's record", () => {
        const { pinia, global } = createTestApp()

        useManagerStore(pinia).load([managerRecord({ queueLength: 3, waitingForRoom: 1, utilization: 0.82 })])

        const wrapper = mount(SystemStatus, { global })

        expect(text(wrapper, 'utilization')).toBe('82%')
        expect(text(wrapper, 'queue-user')).toBe('2')
        expect(text(wrapper, 'queue-capacity')).toBe('1')

        wrapper.unmount()
    })

    test('follows the queue at once', async () => {
        const { pinia, global } = createTestApp()
        const store = useManagerStore(pinia)
        const wrapper = mount(SystemStatus, { global })

        store.set(managerRecord({ queueLength: 4, waitingForRoom: 4 }))
        await nextTick()

        expect(text(wrapper, 'queue-capacity')).toBe('4')

        wrapper.unmount()
    })

    test("follows the utilization at once: the average is the record's", async () => {
        const { pinia, global } = createTestApp()
        const store = useManagerStore(pinia)

        store.load([managerRecord({ utilization: 0.8 })])

        const wrapper = mount(SystemStatus, { global })

        store.set(managerRecord({ utilization: 0.4 }))
        await nextTick()

        expect(text(wrapper, 'utilization')).toBe('40%')

        wrapper.unmount()
    })

    test('marks the utilization when it is above the maximum of automatic mode', async () => {
        const { pinia, global } = createTestApp()
        const store = useManagerStore(pinia)

        store.load([managerRecord({ maxUtilization: 0.7, utilization: 0.7 })])

        const wrapper = mount(SystemStatus, { global })
        const classes = () => wrapper.get('[data-test="utilization"]').classes()

        expect(classes()).not.toContain('over')

        store.set(managerRecord({ maxUtilization: 0.7, utilization: 0.71 }))
        await nextTick()
        expect(classes()).toContain('over')

        store.set(managerRecord({ scalingMode: 'manual', maxUtilization: 0.7, utilization: 0.71 }))
        await nextTick()
        expect(classes()).not.toContain('over')

        wrapper.unmount()
    })

    test('says what the average is over', () => {
        const { global } = createTestApp()
        const wrapper = mount(SystemStatus, { global })

        expect(wrapper.get('dt').text()).toBe('Utilization, 10 s average')

        wrapper.unmount()
    })
})
