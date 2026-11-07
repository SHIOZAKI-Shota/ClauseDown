<script setup lang="ts" generic="T extends string">
export interface SegmentItem<V extends string = string> {
    value: V
    label?: string
    icon?: string
    tooltip?: string
    description?: string
    disabled?: boolean
}

const props = withDefaults(defineProps<{ items: SegmentItem<T>[]; size?: 'xs' | 'sm' | 'md'; ariaLabel?: string }>(), {
    size: 'sm',
    ariaLabel: undefined,
})
const model = defineModel<T | undefined>()
const selected = computed(() => props.items.find((i) => i.value === model.value))
</script>

<template>
    <div class="seg-wrap">
        <UFieldGroup :size="size" role="radiogroup" :aria-label="ariaLabel" class="seg">
            <UTooltip v-for="it in items" :key="it.value" :text="it.tooltip ?? ''" :disabled="!it.tooltip">
                <UButton :label="it.label" :icon="it.icon" :square="!it.label" :disabled="it.disabled"
                    :color="model === it.value ? 'primary' : 'neutral'" :variant="model === it.value ? 'soft' : 'outline'"
                    role="radio" :aria-checked="model === it.value" :aria-label="it.label ?? it.tooltip"
                    @click="model = it.value" />
            </UTooltip>
        </UFieldGroup>
        <p v-if="selected?.description" class="cd-muted desc">{{ selected.description }}</p>
    </div>
</template>

<style scoped>
.seg-wrap {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

.seg {
    flex-wrap: wrap;
}

.desc {
    line-height: 1.6;
}
</style>
