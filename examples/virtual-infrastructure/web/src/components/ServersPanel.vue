<script setup lang="ts">
// The servers, and who decides how many there are: the scaling mode and the maximum utilization.
import { createAddServerCommand } from '@virtual-infrastructure/protocol/servers/servers.commands'
import { createUpdateSettingsCommand } from '@virtual-infrastructure/protocol/settings/settings.commands'
import {
    MAX_MAX_UTILIZATION,
    MIN_MAX_UTILIZATION,
    SETTINGS_KEYS,
} from '@virtual-infrastructure/protocol/settings/settings.constants'
import type { ScalingMode } from '@virtual-infrastructure/protocol/settings/settings.record'
import { computed, ref, watch } from 'vue'
import { useServers, useServerSettings } from '../composables/records.ts'
import { useWebApp } from '../composables/web-app.ts'
import ServerCard from './ServerCard.vue'

const MODES: { mode: ScalingMode; label: string }[] = [
    { mode: 'automatic', label: 'Automatic' },
    { mode: 'manual', label: 'Manual' },
]

const { commands } = useWebApp()
const servers = useServers()
const settings = useServerSettings()

const isManual = computed(() => settings.value.scalingMode === 'manual')

// The slider's own value, in percent, from the first movement until the settings record has the change
const draft = ref<number>()
const maxUtilization = computed(() => draft.value ?? Math.round(settings.value.maxUtilization * 100))

watch(
    () => settings.value.maxUtilization,
    () => (draft.value = undefined),
)

function setMode(mode: ScalingMode): void {
    if (mode === settings.value.scalingMode) return

    commands.send(createUpdateSettingsCommand(SETTINGS_KEYS.servers, { scalingMode: mode }))
}

// On release, not on every movement
async function setMaxUtilization(): Promise<void> {
    const value = draft.value

    if (value === undefined) return

    const fraction = value / 100

    if (
        fraction === settings.value.maxUtilization ||
        !(await commands.send(createUpdateSettingsCommand(SETTINGS_KEYS.servers, { maxUtilization: fraction })))
    ) {
        draft.value = undefined
    }
}
</script>

<template>
    <section class="panel">
        <div class="panel__header">
            <h2>Servers ({{ servers.length }})</h2>
            <button
                v-if="isManual"
                type="button"
                data-test="add-server"
                @click="commands.send(createAddServerCommand())"
            >
                + Add Server
            </button>
        </div>

        <div class="settings">
            <div class="setting">
                <span class="muted">Mode</span>
                <div class="modes" role="group" aria-label="Scaling mode">
                    <button
                        v-for="{ mode, label } in MODES"
                        :key="mode"
                        type="button"
                        class="mode"
                        :class="{ 'mode--active': settings.scalingMode === mode }"
                        :aria-pressed="settings.scalingMode === mode"
                        :data-test="`mode-${mode}`"
                        @click="setMode(mode)"
                    >
                        {{ label }}
                    </button>
                </div>
            </div>

            <label class="setting">
                <span class="muted">Maximum utilization</span>
                <input
                    type="range"
                    :min="MIN_MAX_UTILIZATION * 100"
                    :max="MAX_MAX_UTILIZATION * 100"
                    step="5"
                    :value="maxUtilization"
                    :disabled="isManual"
                    data-test="max-utilization"
                    @input="draft = Number(($event.target as HTMLInputElement).value)"
                    @change="setMaxUtilization()"
                />
                <span class="value" data-test="max-utilization-value">{{ maxUtilization }}%</span>
            </label>
        </div>

        <p v-if="servers.length === 0" class="empty">No servers.</p>
        <div v-else class="cards">
            <ServerCard v-for="server in servers" :key="server.id" :server="server" :removable="isManual" />
        </div>
    </section>
</template>

<style scoped>
.settings {
    display: grid;
    gap: 0.6rem;
    margin-bottom: 1rem;
}

.setting {
    display: grid;
    grid-template-columns: 10rem 1fr 3rem;
    align-items: center;
    gap: 0.75rem;
}

.modes {
    display: flex;
}

.mode {
    border-radius: 0;
}

.mode:first-child {
    border-radius: 6px 0 0 6px;
}

.mode:last-child {
    border-left: 0;
    border-radius: 0 6px 6px 0;
}

.mode--active {
    border-color: var(--accent);
    color: #fff;
    background: var(--accent);
}

.value {
    text-align: right;
}
</style>
