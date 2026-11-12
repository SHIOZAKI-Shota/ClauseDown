<script setup lang="ts">
defineProps<{ title: string; summary?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
    <UModal :open="true" fullscreen @update:open="(v) => !v && emit('close')">
        <template #content>
            <div class="ws">
                <header class="ws-head">
                    <div class="ws-title">
                        <strong>{{ title }}</strong>
                        <span v-if="summary" class="summary">{{ summary }}</span>
                    </div>
                    <span class="cd-grow" />
                    <slot name="actions" />
                    <UButton icon="i-lucide-x" color="neutral" variant="ghost" square @click="emit('close')" />
                </header>
                <div class="ws-main">
                    <slot />
                </div>
                <footer class="ws-foot">
                    <slot name="footer" />
                </footer>
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.ws {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--ui-bg);
}

.ws-head {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    padding: 0 8px 0 16px;
    flex-shrink: 0;
}

.ws-title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
}

.ws-title strong {
    font-size: 14px;
    white-space: nowrap;
}

.summary {
    color: var(--ui-text-muted);
    font-size: 12px;
    white-space: nowrap;
}

.ws-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.ws-main > :deep(*) {
    flex: 1;
    min-height: 0;
}

.ws-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-top: 1px solid var(--ui-border);
    flex-shrink: 0;
}
</style>
