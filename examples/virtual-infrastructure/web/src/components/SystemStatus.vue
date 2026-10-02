<script setup lang="ts">
// What the ServerManager reports of itself, from its status record.
import { onScopeDispose } from 'vue'
import { useServerStatus } from '../composables/records.ts'
import { percent } from '../format.ts'
import { createMovingAverage } from '../moving-average.ts'
import type { MovingAverageOptions } from '../moving-average.ts'

// The utilization jumps with every command that starts or ends, so it is shown as its average over 15 seconds
const props = withDefaults(defineProps<{ smoothing?: MovingAverageOptions }>(), {
    smoothing: () => ({ interval: 1_000, samples: 15 }),
})

const status = useServerStatus()
const { value: utilization, stop } = createMovingAverage(() => status.value.utilization, props.smoothing)

onScopeDispose(stop)

const seconds = Math.round((props.smoothing.interval * props.smoothing.samples) / 1_000)
</script>

<template>
    <dl class="status">
        <div>
            <dt>Utilization, {{ seconds }} s average</dt>
            <dd data-test="utilization">{{ percent(utilization) }}</dd>
        </div>
        <div>
            <dt>Commands waiting</dt>
            <dd data-test="queue-length">{{ status.queueLength }}</dd>
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
</style>
