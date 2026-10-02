<script setup lang="ts">
import { createAddUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import { useUsers } from '../composables/records.ts'
import { useWebApp } from '../composables/web-app.ts'
import UserCard from './UserCard.vue'

const { commands } = useWebApp()
const users = useUsers()
</script>

<template>
    <section class="panel">
        <div class="panel__header">
            <h2>Users ({{ users.length }})</h2>
            <button type="button" data-test="add-user" @click="commands.send(createAddUserCommand())">
                + Add User
            </button>
        </div>

        <p v-if="users.length === 0" class="empty">No users.</p>
        <div v-else class="cards">
            <UserCard v-for="user in users" :key="user.id" :user="user" />
        </div>
    </section>
</template>
