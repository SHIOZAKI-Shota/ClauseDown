<script setup lang="ts">
import type { Ref } from 'vue'
import type { LegalDoc } from '@shared/legal-parser'
import { positionLabel } from '~/utils/legal-editor'

const props = defineProps<{ doc: LegalDoc; cursor: { line: Readonly<Ref<number>> } }>()
const label = computed(() => positionLabel(props.doc, props.cursor.line.value))
</script>

<template>
    <span class="pos"><UIcon name="i-lucide-map-pin" />{{ label || '—' }}</span>
</template>

<style scoped>
.pos {
    color: var(--ui-text-toned);
    font-weight: 600;
}
</style>
