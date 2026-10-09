import { describe, expect, test } from 'bun:test'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createTestApp } from '../test-support.ts'
import AboutDialog from './AboutDialog.vue'

const setUp = () => {
    const testApp = createTestApp()
    const wrapper = mount(AboutDialog, { global: testApp.global, attachTo: document.body })
    const dialog = () => wrapper.get('[data-test="about"]').element as HTMLDialogElement

    return { ...testApp, wrapper, dialog }
}

describe('AboutDialog', () => {
    test('is closed until asked for', async () => {
        const { wrapper, dialog } = setUp()

        expect(dialog().open).toBe(false)

        await wrapper.get('[data-test="about-open"]').trigger('click')

        expect(dialog().open).toBe(true)
        expect(wrapper.get('[data-test="about"]').text()).toContain('Virtual Infrastructure Simulator')

        wrapper.unmount()
    })

    test('closes by its button', async () => {
        const { wrapper, dialog } = setUp()

        await wrapper.get('[data-test="about-open"]').trigger('click')
        await wrapper.get('[data-test="about-close"]').trigger('click')

        expect(dialog().open).toBe(false)

        wrapper.unmount()
    })

    test('closes by a click beside it, not by a click inside', async () => {
        const { wrapper, dialog } = setUp()

        await wrapper.get('[data-test="about-open"]').trigger('click')
        await wrapper.get('h2').trigger('click')
        expect(dialog().open).toBe(true)

        await wrapper.get('[data-test="about"]').trigger('click')
        expect(dialog().open).toBe(false)

        wrapper.unmount()
    })

    test('has no links out until it is given some, then shows them as given', async () => {
        const { config, wrapper } = setUp()
        const links = () =>
            wrapper.findAll('[data-test="about-link"]').map(link => [link.text(), link.attributes('href')])

        expect(wrapper.find('a').exists()).toBe(false)
        expect(wrapper.find('ul').exists()).toBe(false)

        config.value = {
            links: [
                { label: 'Source code', url: 'https://git.example.com/demo' },
                { label: 'More about this demo', url: 'https://demo.example.com/virtual-infrastructure' },
            ],
        }
        await nextTick()

        expect(links()).toEqual([
            ['Source code', 'https://git.example.com/demo'],
            ['More about this demo', 'https://demo.example.com/virtual-infrastructure'],
        ])

        wrapper.unmount()
    })
})
