<script setup lang="ts">
defineProps<{ label: string; icon?: string; count?: number; pinned?: boolean }>()
</script>

<template>
    <div class="cd-sec-head" :class="{ pinned }">
        <UIcon v-if="icon" :name="icon" class="ic" />
        <span class="label">{{ label }}</span>
        <span v-if="count" class="count">{{ count }}</span>
        <span class="cd-grow" />
        <slot />
    </div>
</template>

<style scoped>
.cd-sec-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--ui-text-muted);
}

.pinned {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 4px 6px 4px 12px;
    background: var(--ui-bg);
}

.ic {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
}

.label {
    white-space: nowrap;
}

.count {
    font-weight: 400;
    color: var(--ui-text-dimmed);
}
</style>
