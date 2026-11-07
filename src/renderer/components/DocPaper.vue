<script setup lang="ts">
import { parseLegal } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'

const props = defineProps<{ text: string | null | undefined; empty?: string }>()
const html = computed(() => (typeof props.text === 'string' ? renderDoc(parseLegal(props.text)) : ''))
</script>

<template>
    <div class="cd-preview cd-canvas">
        <p v-if="text === null" class="cd-muted">{{ empty ?? 'この版にはこの文書がありません。' }}</p>
        <div v-else-if="text !== undefined" class="paper cd-paper" v-html="html" />
    </div>
</template>

<style scoped>
.paper {
    max-width: 210mm;
    margin: 0 auto;
    padding: var(--cd-margin, 20mm);
}
</style>
