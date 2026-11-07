<script setup lang="ts">
import type { Ref } from 'vue'

const props = defineProps<{ id: string; title: string }>()
const prefix = inject<string>('settingsIdPrefix', '')
const active = inject<Ref<string> | null>('settingsActive', null)
const elId = computed(() => (prefix ? `${prefix}-${props.id}` : props.id))
const shown = computed(() => !active || active.value === props.id)
</script>

<template>
    <section v-show="shown" :id="elId">
        <h2>{{ title }}</h2>
        <slot />
    </section>
</template>

<style scoped>
h2 {
    font-size: 15px;
    font-weight: 700;
    margin: 0 0 4px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--ui-border-accented);
}
</style>
