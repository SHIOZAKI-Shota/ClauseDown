<script setup lang="ts">
import type { Pane } from '~/composables/usePane'

const props = defineProps<{
    pane: Pane
    side: 'left' | 'right'
    label: string
}>()

const collapseIcon = computed(() => (props.side === 'left' ? 'i-lucide-panel-left-close' : 'i-lucide-panel-right-close'))
</script>

<template>
    <UTooltip :text="`${label}を折りたたむ`">
        <UButton
            :icon="collapseIcon"
            size="xs"
            square
            color="neutral"
            variant="ghost"
            class="shrink-0"
            :aria-label="`${label}を折りたたむ`"
            @click="pane.collapse()"
        />
    </UTooltip>
</template>
