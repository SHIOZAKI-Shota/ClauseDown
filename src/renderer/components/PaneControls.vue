<script setup lang="ts">
import type { Pane } from '~/composables/usePane'

const props = defineProps<{
    pane: Pane
    side: 'left' | 'right'
    label: string
}>()

const t = useT()
const collapseIcon = computed(() => (props.side === 'left' ? 'i-lucide-panel-left-close' : 'i-lucide-panel-right-close'))
</script>

<template>
    <UTooltip :text="t.shell.pane.collapse(label)">
        <UButton
            :icon="collapseIcon"
            size="xs"
            square
            color="neutral"
            variant="ghost"
            class="shrink-0"
            :aria-label="t.shell.pane.collapse(label)"
            @click="pane.collapse()"
        />
    </UTooltip>
</template>
