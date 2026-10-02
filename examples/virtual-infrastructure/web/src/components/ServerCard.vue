<script setup lang="ts">
// One server: its load of its capacity, and what its record says of its state.
import { createRemoveServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import type { ServerRecord } from '@virtual-infrastructure/protocol/servers/servers.record'
import { computed } from 'vue'
import { useWebApp } from '../composables/web-app.ts'
import { level, percent } from '../format.ts'

const props = defineProps<{
    server: ServerRecord
    /** Whether the Demo User may remove it: in manual mode only. */
    removable: boolean
}>()

const { commands } = useWebApp()

const utilization = computed(() => (props.server.capacity > 0 ? props.server.load / props.server.capacity : 0))
</script>

<template>
    <article class="card" :class="{ 'card--draining': server.isDraining }" data-test="server">
        <div class="card__header">
            <strong>{{ server.name }}</strong>
            <span v-if="server.isDraining" class="badge" data-test="draining">draining</span>
            <button
                v-if="removable"
                type="button"
                :aria-label="`Remove ${server.name}`"
                data-test="remove-server"
                @click="commands.send(createRemoveServerCommand(props.server.id))"
            >
                −
            </button>
        </div>

        <p class="load">
            <span data-test="load">{{ server.load }} / {{ server.capacity }} units</span>
            <span class="muted" data-test="active-commands">{{ server.activeCommands }} active</span>
        </p>

        <div class="bar">
            <div
                class="bar__fill"
                :class="`bar__fill--${level(utilization)}`"
                :style="{ width: percent(utilization) }"
            />
        </div>
    </article>
</template>

<style scoped>
.card--draining {
    border-style: dashed;
}

.badge {
    margin-left: auto;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    color: #fff;
    background: var(--medium);
    font-size: 0.75rem;
}

.load {
    display: flex;
    justify-content: space-between;
    margin: 0 0 0.5rem;
}
</style>
