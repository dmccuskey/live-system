import { describe, expect, test } from 'bun:test'
import { flushPromises, mount } from '@vue/test-utils'
import {
    createAddServerCommand,
    createRemoveServerCommand,
} from '@virtual-infrastructure/protocol/servers/servers.commands'
import { createUpdateSettingsCommand } from '@virtual-infrastructure/protocol/settings/settings.commands'
import type { ScalingMode } from '@virtual-infrastructure/protocol/settings/settings.record'
import type { Pinia } from 'pinia'
import { nextTick } from 'vue'
import { useServerStore, useSettingsStore } from '../stores.ts'
import { createTestApp, serverRecord } from '../test-support.ts'
import ServerCard from './ServerCard.vue'
import ServersPanel from './ServersPanel.vue'

const setSettings = (pinia: Pinia, scalingMode: ScalingMode, maxUtilization = 0.75) =>
    useSettingsStore(pinia).set({ id: 'x', key: 'servers', scalingMode, maxUtilization })

describe('ServersPanel', () => {
    test('says so when there are no servers', () => {
        const { global } = createTestApp()

        expect(mount(ServersPanel, { global }).text()).toContain('No servers.')
    })

    test('shows a card per server, by name, and their number', () => {
        const { pinia, global } = createTestApp()

        useServerStore(pinia).load([
            serverRecord({ id: 'a', name: 'Server 10' }),
            serverRecord({ id: 'b', name: 'Server 2' }),
        ])

        const wrapper = mount(ServersPanel, { global })

        expect(wrapper.findAll('[data-test="server"] strong').map(name => name.text())).toEqual([
            'Server 2',
            'Server 10',
        ])
        expect(wrapper.get('h2').text()).toBe('Servers (2)')
    })

    test('shows the defaults while there is no settings record: automatic, 75%', () => {
        const { global } = createTestApp()
        const wrapper = mount(ServersPanel, { global })

        expect(wrapper.get('[data-test="mode-automatic"]').attributes('aria-pressed')).toBe('true')
        expect(wrapper.get('[data-test="mode-manual"]').attributes('aria-pressed')).toBe('false')
        expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('75%')
    })

    test('shows the mode and the maximum utilization of the settings record, and follows it', async () => {
        const { pinia, global } = createTestApp()

        setSettings(pinia, 'manual', 0.6)

        const wrapper = mount(ServersPanel, { global })

        expect(wrapper.get('[data-test="mode-manual"]').attributes('aria-pressed')).toBe('true')
        expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('60%')

        setSettings(pinia, 'automatic', 0.9)
        await nextTick()

        expect(wrapper.get('[data-test="mode-automatic"]').attributes('aria-pressed')).toBe('true')
        expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('90%')
    })

    test('in automatic mode there is no add control and no remove control', () => {
        const { pinia, global } = createTestApp()

        setSettings(pinia, 'automatic')
        useServerStore(pinia).load([serverRecord()])

        const wrapper = mount(ServersPanel, { global })

        expect(wrapper.find('[data-test="add-server"]').exists()).toBe(false)
        expect(wrapper.find('[data-test="remove-server"]').exists()).toBe(false)
    })

    test('in manual mode there are both, and the slider is disabled', () => {
        const { pinia, global } = createTestApp()

        setSettings(pinia, 'manual')
        useServerStore(pinia).load([serverRecord()])

        const wrapper = mount(ServersPanel, { global })

        expect(wrapper.find('[data-test="add-server"]').exists()).toBe(true)
        expect(wrapper.find('[data-test="remove-server"]').exists()).toBe(true)
        expect(wrapper.get('[data-test="max-utilization"]').attributes('disabled')).toBeDefined()
    })

    test('the add control sends the add command', async () => {
        const { pinia, sent, global } = createTestApp()

        setSettings(pinia, 'manual')

        const wrapper = mount(ServersPanel, { global })

        await wrapper.get('[data-test="add-server"]').trigger('click')
        await flushPromises()

        expect(sent.map(command => command.route)).toEqual([createAddServerCommand().route])
    })

    test('choosing the other mode sends the settings command, and changes nothing by itself', async () => {
        const { sent, global } = createTestApp()
        const wrapper = mount(ServersPanel, { global })

        await wrapper.get('[data-test="mode-manual"]').trigger('click')
        await flushPromises()

        expect(sent).toEqual([createUpdateSettingsCommand('servers', { scalingMode: 'manual' })])
        // The mode shown is the record's: it changes when the record does
        expect(wrapper.get('[data-test="mode-automatic"]').attributes('aria-pressed')).toBe('true')
    })

    test('choosing the mode already in force sends nothing', async () => {
        const { sent, global } = createTestApp()
        const wrapper = mount(ServersPanel, { global })

        await wrapper.get('[data-test="mode-automatic"]').trigger('click')
        await flushPromises()

        expect(sent).toEqual([])
    })

    describe('the maximum utilization slider', () => {
        const move = async (wrapper: ReturnType<typeof mount>, value: number) => {
            const slider = wrapper.get('[data-test="max-utilization"]')

            ;(slider.element as HTMLInputElement).value = String(value)
            await slider.trigger('input')

            return slider
        }

        test('runs from 30 to 95', () => {
            const { global } = createTestApp()
            const slider = mount(ServersPanel, { global }).get('[data-test="max-utilization"]')

            expect(slider.attributes('min')).toBe('30')
            expect(slider.attributes('max')).toBe('95')
        })

        test('shows its value while it moves, and sends nothing yet', async () => {
            const { sent, global } = createTestApp()
            const wrapper = mount(ServersPanel, { global })

            await move(wrapper, 50)
            await flushPromises()

            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('50%')
            expect(sent).toEqual([])
        })

        test('sends the settings command when released, as a fraction', async () => {
            const { sent, global } = createTestApp()
            const wrapper = mount(ServersPanel, { global })

            await (await move(wrapper, 50)).trigger('change')
            await flushPromises()

            expect(sent).toEqual([createUpdateSettingsCommand('servers', { maxUtilization: 0.5 })])
        })

        test('keeps its value until the record has the change', async () => {
            const { pinia, global } = createTestApp()

            setSettings(pinia, 'automatic', 0.75)

            const wrapper = mount(ServersPanel, { global })

            await (await move(wrapper, 50)).trigger('change')
            await flushPromises()

            // Accepted, and the record not yet changed: no jump back to 75
            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('50%')

            setSettings(pinia, 'automatic', 0.5)
            await nextTick()

            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('50%')

            // From here on it follows the record again
            setSettings(pinia, 'automatic', 0.8)
            await nextTick()

            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('80%')
        })

        test('goes back to the record`s value when the command fails', async () => {
            const { global } = createTestApp(() => ({
                status: 'failed',
                error: { name: 'CommandError', message: 'No', code: 'internal' },
            }))
            const wrapper = mount(ServersPanel, { global })

            await (await move(wrapper, 50)).trigger('change')
            await flushPromises()

            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('75%')
        })

        test('released where it was, sends nothing', async () => {
            const { sent, global } = createTestApp()
            const wrapper = mount(ServersPanel, { global })

            await move(wrapper, 50)
            await (await move(wrapper, 75)).trigger('change')
            await flushPromises()

            expect(sent).toEqual([])
            expect(wrapper.get('[data-test="max-utilization-value"]').text()).toBe('75%')
        })
    })
})

describe('ServerCard', () => {
    test('shows the load of the capacity and the active commands', () => {
        const { global } = createTestApp()
        const wrapper = mount(ServerCard, { props: { server: serverRecord(), removable: false }, global })

        expect(wrapper.get('strong').text()).toBe('Server 1')
        expect(wrapper.get('[data-test="load"]').text()).toBe('4 / 10 units')
        expect(wrapper.get('[data-test="active-commands"]').text()).toBe('2 active')
    })

    test.each([
        [2, 'low', '20%'],
        [5, 'medium', '50%'],
        [10, 'high', '100%'],
    ])('a load of %p of 10 has a %s bar of %s', (load, level, width) => {
        const { global } = createTestApp()
        const wrapper = mount(ServerCard, { props: { server: serverRecord({ load }), removable: false }, global })
        const fill = wrapper.get('.bar__fill')

        expect(fill.classes()).toContain(`bar__fill--${level}`)
        expect(fill.attributes('style')).toContain(`width: ${width}`)
    })

    test('a server without capacity has an empty bar', () => {
        const { global } = createTestApp()
        const server = serverRecord({ capacity: 0, load: 0 })
        const wrapper = mount(ServerCard, { props: { server, removable: false }, global })

        expect(wrapper.get('.bar__fill').attributes('style')).toContain('width: 0%')
    })

    test('says when the server is draining', async () => {
        const { global } = createTestApp()
        const wrapper = mount(ServerCard, { props: { server: serverRecord(), removable: false }, global })

        expect(wrapper.find('[data-test="draining"]').exists()).toBe(false)

        await wrapper.setProps({ server: serverRecord({ isDraining: true }) })

        expect(wrapper.find('[data-test="draining"]').exists()).toBe(true)
    })

    test('has a remove control only when removable, which sends the remove command for this server', async () => {
        const { sent, global } = createTestApp()
        const server = serverRecord({ id: 's9' })
        const wrapper = mount(ServerCard, { props: { server, removable: false }, global })

        expect(wrapper.find('[data-test="remove-server"]').exists()).toBe(false)

        await wrapper.setProps({ removable: true })
        await wrapper.get('[data-test="remove-server"]').trigger('click')
        await flushPromises()

        expect(sent.map(command => command.route)).toEqual([createRemoveServerCommand('s9').route])
    })
})
