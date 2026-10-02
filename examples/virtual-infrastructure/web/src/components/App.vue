<script setup lang="ts">
// The whole page. It is mounted at once and renders from the system status, the connection status and the stores.
import { computed } from 'vue'
import { useWebApp } from '../composables/web-app.ts'
import ServersPanel from './ServersPanel.vue'
import SystemStatus from './SystemStatus.vue'
import UsersPanel from './UsersPanel.vue'

const { status, isConnected, commands } = useWebApp()
const commandError = commands.error

const startupError = computed(() => (status.error instanceof Error ? status.error.message : String(status.error)))
</script>

<template>
    <main class="app">
        <header class="header">
            <h1>Virtual Infrastructure Simulator</h1>
            <SystemStatus v-if="status.phase === 'running'" />
        </header>

        <p v-if="commandError" class="notice notice--error" role="alert" data-test="command-error">
            {{ commandError }}
            <button type="button" aria-label="Dismiss" @click="commands.dismiss()">×</button>
        </p>

        <p v-if="status.phase === 'created' || status.phase === 'starting'" class="loading" data-test="loading">
            Connecting to the data service…
        </p>

        <div v-else-if="status.phase === 'failed'" class="notice notice--error" data-test="startup-failed">
            <strong>The system could not start.</strong>
            {{ startupError }}
        </div>

        <p v-else-if="status.phase === 'stopped'" class="loading" data-test="stopped">The system is stopped.</p>

        <template v-else>
            <p v-if="!isConnected" class="notice notice--warning" role="status" data-test="disconnected">
                The connection to the data service is lost. What is shown may be out of date.
            </p>

            <div class="panels">
                <UsersPanel />
                <ServersPanel />
            </div>
        </template>
    </main>
</template>

<style>
:root {
    --background: #f4f5f7;
    --surface: #ffffff;
    --border: #d9dce1;
    --text: #1d2330;
    --muted: #677084;
    --accent: #2f6fde;
    --low: #2e9e5b;
    --medium: #d99a1c;
    --high: #d6453d;
    --calm: #2e9e5b;
    --uneasy: #e2c21c;
    --annoyed: #e8862a;
    --angry: #d6453d;

    color: var(--text);
    background: var(--background);
    font-family: system-ui, sans-serif;
    font-size: 15px;
}

@media (prefers-color-scheme: dark) {
    :root {
        --background: #14171d;
        --surface: #1e222b;
        --border: #343a47;
        --text: #e6e9ef;
        --muted: #98a1b3;
        --accent: #6c9cf0;
    }
}

body {
    margin: 0;
}

button {
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: inherit;
    background: var(--surface);
    font: inherit;
    cursor: pointer;
}

button:hover {
    border-color: var(--accent);
}

.panel {
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
}

.panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
}

.panel__header h2 {
    margin: 0;
    font-size: 1.1rem;
}

.card {
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
}

.card__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}

.cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
    gap: 0.75rem;
}

.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.empty,
.muted {
    color: var(--muted);
}

.bar {
    height: 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--border);
}

.bar__fill {
    height: 100%;
    border-radius: inherit;
    background: var(--low);
    transition: width 0.3s;
}

.bar__fill--medium {
    background: var(--medium);
}

.bar__fill--high {
    background: var(--high);
}
</style>

<style scoped>
.app {
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem;
}

.header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
}

.header h1 {
    margin: 0;
    font-size: 1.4rem;
}

.panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    align-items: start;
    gap: 1rem;
}

.notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0 0 1rem;
    padding: 0.6rem 0.9rem;
    border: 1px solid;
    border-radius: 8px;
}

.notice--error {
    border-color: var(--high);
}

.notice--warning {
    border-color: var(--medium);
}

.loading {
    color: var(--muted);
}
</style>
