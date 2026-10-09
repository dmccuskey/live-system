<script setup lang="ts">
// One user: its fixed profile, how well it is served, and its frustration.
import { createRemoveUserCommand } from '@virtual-infrastructure/protocol/users/users.commands'
import type { UserRecord } from '@virtual-infrastructure/protocol/users/users.record'
import { useWebApp } from '../composables/web-app.ts'
import { mood, percent, service } from '../format.ts'

const props = defineProps<{ user: UserRecord }>()

const { commands } = useWebApp()
</script>

<template>
    <article class="card" data-test="user">
        <div class="card__header">
            <span>
                <strong>{{ user.name }}</strong>
                <span class="rate muted" data-test="rate">{{ user.commandsPerMinute }}/min</span>
            </span>
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
            <dd class="meter" :title="`${percent(user.served)} of its commands of late were served`">
                <div class="bar">
                    <div
                        class="bar__fill"
                        :class="`bar__fill--${service(user.served)}`"
                        :style="{ width: percent(user.served) }"
                        data-test="served-bar"
                    />
                </div>
                <span data-test="served">{{ percent(user.served) }}</span>
            </dd>
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
            <dd class="meter">
                <div class="bar">
                    <div
                        class="bar__fill"
                        :class="`bar__fill--${mood(user.frustration)}`"
                        :style="{ width: percent(user.frustration) }"
                        data-test="frustration-bar"
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

.rate {
    margin-left: 0.35rem;
    font-size: 0.85rem;
}

/* A bar beside its value: alone at the foot of the card it reads as a scrollbar */
.meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.meter .bar {
    flex: 1;
}

.meter span {
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
