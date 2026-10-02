<script setup lang="ts">
// One user: its fixed profile and its frustration.
import { createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { useWebApp } from '../composables/web-app.ts'
import { mood, percent } from '../format.ts'

const props = defineProps<{ user: UserRecord }>()

const { commands } = useWebApp()
</script>

<template>
    <article class="card" data-test="user">
        <div class="card__header">
            <strong>{{ user.name }}</strong>
            <button
                type="button"
                :aria-label="`Remove ${user.name}`"
                data-test="remove-user"
                @click="commands.send(createRemoveUserCommand(props.user.id))"
            >
                −
            </button>
        </div>

        <dl class="profile">
            <dt>Activity</dt>
            <dd data-test="activity">{{ user.commandsPerMinute }} commands/min</dd>
            <dt class="visually-hidden">Command mix</dt>
            <dd class="mix" data-test="mix">
                <span><span class="muted">Se</span> {{ percent(user.commandMix.search) }}</span>
                <span><span class="muted">St</span> {{ percent(user.commandMix.standard) }}</span>
                <span><span class="muted">Ag</span> {{ percent(user.commandMix.agentic) }}</span>
                <span class="mix__tip" role="tooltip" data-test="mix-tip">
                    Search {{ percent(user.commandMix.search) }} · Standard {{ percent(user.commandMix.standard) }} ·
                    Agentic {{ percent(user.commandMix.agentic) }}
                </span>
            </dd>
            <dt>Frustration</dt>
            <dd class="frustration">
                <div class="bar">
                    <div
                        class="bar__fill"
                        :class="`bar__fill--${mood(user.frustration)}`"
                        :style="{ width: percent(user.frustration) }"
                    />
                </div>
                <span data-test="frustration">{{ percent(user.frustration) }}</span>
            </dd>
        </dl>
    </article>
</template>

<style scoped>
.profile {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.75rem;
    margin: 0;
}

dt {
    color: var(--muted);
}

dd {
    margin: 0;
    text-align: right;
}

/* The whole row: three values do not fit beside a label */
.mix {
    display: flex;
    grid-column: 1 / -1;
    position: relative;
    justify-content: space-between;
    white-space: nowrap;
    cursor: default;
}

/* Shown while the pointer is anywhere on the row */
.mix__tip {
    position: absolute;
    bottom: calc(100% + 0.3rem);
    left: 50%;
    z-index: 1;
    display: none;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    color: var(--background);
    background: var(--text);
    font-size: 0.85rem;
    transform: translateX(-50%);
}

.mix:hover .mix__tip {
    display: block;
}

/* The bar beside its value: alone at the foot of the card it reads as a scrollbar */
.frustration {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.frustration .bar {
    flex: 1;
}

.frustration span {
    min-width: 2.5rem;
}

.bar__fill--calm {
    background: var(--calm);
}

.bar__fill--uneasy {
    background: var(--uneasy);
}

.bar__fill--annoyed {
    background: var(--annoyed);
}

.bar__fill--angry {
    background: var(--angry);
}
</style>
