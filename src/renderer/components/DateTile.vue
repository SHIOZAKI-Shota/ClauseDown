<script setup lang="ts">
import { daysUntil, todayISO, urgencyOf } from '~/utils/format'

const props = defineProps<{
    date: string
    active?: boolean
    fadePast?: boolean
}>()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const today = todayISO()
const d = computed(() => new Date(`${props.date}T00:00:00`))
const otherYear = computed(() => d.value.getFullYear() !== Number(today.slice(0, 4)))
const n = computed(() => daysUntil(props.date, today))
</script>

<template>
    <span class="tile" :class="[urgencyOf(n), { active, past: fadePast && n < 0 }]" :title="date">
        <span v-if="otherYear" class="y">{{ d.getFullYear() }}</span>
        <span class="md">{{ d.getMonth() + 1 }}/{{ d.getDate() }}</span>
        <span class="w">{{ WEEK[d.getDay()] }}</span>
    </span>
</template>

<style scoped>
.tile {
    flex-shrink: 0;
    width: 46px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3px 0;
    border-radius: 8px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}

.y,
.w {
    font-size: 10px;
    color: var(--ui-text-muted);
}

.md {
    font-size: 14px;
    font-weight: 700;
}

.near {
    border-color: color-mix(in oklab, var(--ui-color-warning-500) 50%, transparent);
}

.soon {
    border-color: var(--ui-color-error-500);
    background: color-mix(in oklab, var(--ui-color-error-500) 10%, transparent);
}

.active {
    border-color: var(--ui-color-primary-500);
    background: color-mix(in oklab, var(--ui-color-primary-500) 10%, transparent);
}

.past {
    opacity: 0.6;
}
</style>
