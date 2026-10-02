<script setup lang="ts">
// What the ServerManager reports of itself, from its status record.
import { UTILIZATION_WINDOW } from '@virtual-infrastructure/protocol/servers/servers.constants'
import { useServerStatus } from '../composables/records.ts'
import { percent } from '../format.ts'

// The utilization in the record is the live server's average, the one automatic scaling goes by
const status = useServerStatus()
const seconds = Math.round(UTILIZATION_WINDOW / 1_000)
</script>

<template>
    <dl class="status">
        <div>
            <dt>Utilization, {{ seconds }} s average</dt>
            <dd data-test="utilization">{{ percent(status.utilization) }}</dd>
        </div>
        <div>
            <dt>Command queue</dt>
            <dd>
                <span class="reason">User:</span>
                <span data-test="queue-user">{{ status.queueLength - status.waitingForRoom }}</span
                ><span class="reason">, Capacity:</span>
                <span data-test="queue-capacity">{{ status.waitingForRoom }}</span>
            </dd>
        </div>
    </dl>
</template>

<style scoped>
.status {
    display: flex;
    gap: 1.5rem;
    margin: 0;
}

dt {
    color: var(--muted);
    font-size: 0.8rem;
}

dd {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
}

.reason {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
}
</style>
