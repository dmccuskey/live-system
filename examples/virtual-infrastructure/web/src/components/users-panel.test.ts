import { describe, expect, test } from 'bun:test'
import { flushPromises, mount } from '@vue/test-utils'
import { createAddUserCommand, createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import { nextTick } from 'vue'
import { useUserStore } from '../stores.ts'
import { createTestApp, userRecord } from '../test-support.ts'
import UserCard from './UserCard.vue'
import UsersPanel from './UsersPanel.vue'

describe('UsersPanel', () => {
    test('says so when there are no users', () => {
        const { global } = createTestApp()
        const wrapper = mount(UsersPanel, { global })

        expect(wrapper.text()).toContain('No users.')
        expect(wrapper.findAll('[data-test="user"]')).toHaveLength(0)
    })

    test('shows a card per user, by name, and their number', () => {
        const { pinia, global } = createTestApp()

        useUserStore(pinia).load([userRecord({ id: 'b', name: 'Bob' }), userRecord({ id: 'a', name: 'Alice' })])

        const wrapper = mount(UsersPanel, { global })
        const names = wrapper.findAll('[data-test="user"] strong').map(name => name.text())

        expect(names).toEqual(['Alice', 'Bob'])
        expect(wrapper.get('h2').text()).toBe('Users (2)')
    })

    test('follows users as they come and go', async () => {
        const { pinia, global } = createTestApp()
        const store = useUserStore(pinia)
        const wrapper = mount(UsersPanel, { global })

        store.set(userRecord({ id: 'a', name: 'Alice' }))
        await nextTick()
        expect(wrapper.findAll('[data-test="user"]')).toHaveLength(1)

        store.remove('a')
        await nextTick()
        expect(wrapper.findAll('[data-test="user"]')).toHaveLength(0)
    })

    test('the add control sends the add command', async () => {
        const { sent, global } = createTestApp()
        const wrapper = mount(UsersPanel, { global })

        await wrapper.get('[data-test="add-user"]').trigger('click')
        await flushPromises()

        expect(sent.map(command => command.route)).toEqual([createAddUserCommand().route])
    })

    test('adds no user by itself: the card comes with the record', async () => {
        const { global } = createTestApp()
        const wrapper = mount(UsersPanel, { global })

        await wrapper.get('[data-test="add-user"]').trigger('click')
        await flushPromises()

        expect(wrapper.findAll('[data-test="user"]')).toHaveLength(0)
    })
})

describe('UserCard', () => {
    test('shows the profile, what is served and the frustration', () => {
        const { global } = createTestApp()
        const wrapper = mount(UserCard, { props: { user: userRecord() }, global })
        const values = wrapper.findAll('dd:not(.mix)').map(value => value.text())

        expect(wrapper.get('strong').text()).toBe('Alice')
        expect(wrapper.get('[data-test="rate"]').text()).toBe('8/min')
        expect(values).toEqual(['100%', '14%'])
        expect(wrapper.findAll('[data-test="mix"] > span:not(.mix__tip)').map(part => part.text())).toEqual([
            'Se 70%',
            'St 20%',
            'Ag 10%',
        ])
        expect(wrapper.get('[data-test="mix-tip"]').text()).toBe('Search 70% · Standard 20% · Agentic 10%')
    })

    test.each([
        [0.1, 'calm', '10%'],
        [0.3, 'uneasy', '30%'],
        [0.6, 'annoyed', '60%'],
        [0.9, 'angry', '90%'],
    ])('a frustration of %p has a %s bar of %s', (frustration, level, width) => {
        const { global } = createTestApp()
        const wrapper = mount(UserCard, { props: { user: userRecord({ frustration }) }, global })
        const fill = wrapper.get('[data-test="frustration-bar"]')

        expect(fill.classes()).toContain(`bar__fill--${level}`)
        expect(fill.attributes('style')).toContain(`width: ${width}`)
    })

    test.each([
        [1, 'calm', '100%'],
        [0.8, 'uneasy', '80%'],
        [0.6, 'annoyed', '60%'],
        [0.2, 'angry', '20%'],
    ])('with %p served the bar is %s and %s wide', (served, level, width) => {
        const { global } = createTestApp()
        const wrapper = mount(UserCard, { props: { user: userRecord({ served }) }, global })
        const fill = wrapper.get('[data-test="served-bar"]')

        expect(fill.classes()).toContain(`bar__fill--${level}`)
        expect(fill.attributes('style')).toContain(`width: ${width}`)
        expect(wrapper.get('[data-test="served"]').text()).toBe(width)
    })

    test('follows its record', async () => {
        const { global } = createTestApp()
        const wrapper = mount(UserCard, { props: { user: userRecord() }, global })

        await wrapper.setProps({ user: userRecord({ frustration: 0.6, served: 0.5 }) })

        expect(wrapper.get('[data-test="frustration"]').text()).toBe('60%')
        expect(wrapper.get('[data-test="served"]').text()).toBe('50%')
    })

    test('the remove control sends the remove command for this user', async () => {
        const { sent, global } = createTestApp()
        const wrapper = mount(UserCard, { props: { user: userRecord({ id: 'u7' }) }, global })

        await wrapper.get('[data-test="remove-user"]').trigger('click')
        await flushPromises()

        expect(sent.map(command => command.route)).toEqual([createRemoveUserCommand('u7').route])
        expect(wrapper.get('[data-test="remove-user"]').attributes('aria-label')).toBe('Remove Alice')
    })
})
