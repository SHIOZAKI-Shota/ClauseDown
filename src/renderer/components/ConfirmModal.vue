<script setup lang="ts">
withDefaults(
    defineProps<{
        title: string
        description?: string
        confirmLabel: string
        cancelLabel?: string
        color?: 'primary' | 'error'
        loading?: boolean
    }>(),
    { description: undefined, cancelLabel: undefined, color: 'primary', loading: false },
)
const t = useT()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
    <UModal v-model:open="open" :title="title" :description="description">
        <template v-if="$slots.default" #body>
            <slot />
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="cancelLabel ?? t.common.stop" color="neutral" variant="outline" @click="open = false" />
                <UButton :label="confirmLabel" :color="color" :loading="loading" @click="emit('confirm')" />
            </div>
        </template>
    </UModal>
</template>
