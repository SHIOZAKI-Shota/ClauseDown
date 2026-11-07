<script setup lang="ts">
import { paneStyle, type Pane } from '~/composables/usePane'

const props = defineProps<{
    pane: Pane
    side: 'left' | 'right'
    label: string
    icon?: string
}>()
const open = computed(() => !props.pane.state.value.collapsed)
</script>

<template>
    <PaneRail v-if="!open" :pane="pane" :side="side" :label="label" :icon="icon" />
    <PaneResizer v-if="open && side === 'right'" :pane="pane" side="right" :label="label" />
    <section v-show="open" class="cd-pane-col side-pane" :class="side" :style="paneStyle(pane)">
        <div class="cd-pane-bar">
            <span class="cd-pane-title">{{ label }}</span>
            <slot name="bar" />
            <PaneControls :pane="pane" :side="side" :label="label" />
        </div>
        <div class="body">
            <slot />
        </div>
    </section>
    <PaneResizer v-if="open && side === 'left'" :pane="pane" side="left" :label="label" />
</template>

<style scoped>
.side-pane.left {
    border-right: 1px solid var(--ui-border);
}

.side-pane.right {
    border-left: 1px solid var(--ui-border);
}

.body {
    flex: 1;
    min-height: 0;
    overflow: auto;
}
</style>
