<script setup lang="ts">
// What the ServerManager reports of the servers as a whole, from its record.
import { UTILIZATION_WINDOW } from '@virtual-infrastructure/protocol/servers/servers.constants'
import { computed } from 'vue'
import { useServerManagerRecord } from '../composables/records.ts'
import { percent } from '../format.ts'

// The utilization in the record is the live server's average, the one automatic scaling goes by
const record = useServerManagerRecord()
const seconds = Math.round(UTILIZATION_WINDOW / 1_000)

// Above the maximum that automatic scaling is set to keep
const isOver = computed(
    () => record.value.scalingMode === 'automatic' && record.value.utilization > record.value.maxUtilization,
)
</script>

<template>
    <dl class="status">
        <div>
            <dt>Utilization, {{ seconds }} s average</dt>
            <dd data-test="utilization" :class="{ over: isOver }">{{ percent(record.utilization) }}</dd>
        </div>
        <div>
            <dt>Command queue</dt>
            <dd>
                <span class="reason">User:</span>
                <span data-test="queue-user">{{ record.queueLength - record.waitingForRoom }}</span
                ><span class="reason">, Capacity:</span>
                <span data-test="queue-capacity">{{ record.waitingForRoom }}</span>
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

.over {
    color: var(--high);
}

.reason {
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 400;
}
</style>
