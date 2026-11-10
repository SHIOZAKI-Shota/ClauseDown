<script setup lang="ts">
defineProps<{ label?: string; description?: string; stacked?: boolean }>()
</script>

<template>
    <div class="row" :class="{ stacked }">
        <div class="text">
            <div class="label">
                <slot name="label">{{ label }}</slot>
            </div>
            <div v-if="description || $slots.description" class="desc">
                <slot name="description">{{ description }}</slot>
            </div>
        </div>
        <div class="control">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.row {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 12px 0;
    border-bottom: 1px solid var(--ui-border);
}

.row:last-child {
    border-bottom: none;
}

.row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
}

.text {
    flex: 1;
    min-width: 0;
}

.label {
    font-size: 13px;
    color: var(--ui-text-highlighted);
}

.desc {
    font-size: 12px;
    color: var(--ui-text-muted);
    margin-top: 2px;
    line-height: 1.6;
}

.control {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
}

.stacked .control {
    flex-shrink: 1;
}
</style>
