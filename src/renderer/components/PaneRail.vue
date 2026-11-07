<script setup lang="ts">
import type { Pane } from '~/composables/usePane'

const props = defineProps<{
    pane: Pane
    side: 'left' | 'right'
    label: string
    icon?: string
}>()
const openIcon = computed(() => (props.side === 'left' ? 'i-lucide-panel-left-open' : 'i-lucide-panel-right-open'))
</script>

<template>
    <button class="cd-rail" :class="side" :title="`${label}を開く`" :aria-label="`${label}を開く`" @click="pane.expand()">
        <UIcon :name="openIcon" class="open" />
        <UIcon v-if="icon" :name="icon" class="icon" />
        <span class="label">{{ label }}</span>
    </button>
</template>

<style scoped>
.cd-rail {
    flex: 0 0 28px;
    width: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    background: var(--cd-sidebar);
    color: var(--ui-text-muted);
    cursor: pointer;
    min-height: 0;
}

.cd-rail.left {
    border-right: 1px solid var(--ui-border);
}

.cd-rail.right {
    border-left: 1px solid var(--ui-border);
}

.cd-rail:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.label {
    writing-mode: vertical-rl;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
}
</style>
