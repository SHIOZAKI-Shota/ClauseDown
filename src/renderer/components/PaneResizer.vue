<script setup lang="ts">
import type { Pane } from '~/composables/usePane'

const props = defineProps<{
    pane: Pane
    side: 'left' | 'right'
    label: string
}>()

const dragging = ref(false)
let startX = 0
let startW = 0

const widthNow = () => props.pane.state.value.size || props.pane.measure.value?.() || props.pane.opts.min

function down(e: PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    startX = e.clientX
    startW = widthNow()
    dragging.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add('cd-resizing')
}
function move(e: PointerEvent) {
    if (!dragging.value) return
    const dx = e.clientX - startX
    props.pane.setSize(startW + (props.side === 'left' ? dx : -dx))
}
function up() {
    if (!dragging.value) return
    dragging.value = false
    document.body.classList.remove('cd-resizing')
}
onBeforeUnmount(up)

function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16
    const toRight = e.key === 'ArrowRight'
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (toRight === (props.side === 'left')) props.pane.grow(step)
        else props.pane.shrink(step)
    } else if (e.key === 'Home') {
        e.preventDefault()
        props.pane.reset()
    }
}
</script>

<template>
    <div
        class="cd-resizer"
        :class="{ dragging }"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        :aria-label="`${label}の幅を変える`"
        :title="`ドラッグで${label}の幅を変更（ダブルクリックで元の幅）`"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @dblclick="pane.reset()"
        @keydown="key"
    />
</template>

<style scoped>
.cd-resizer {
    position: relative;
    flex: 0 0 7px;
    margin: 0 -3px;
    z-index: 5;
    cursor: col-resize;
    touch-action: none;
    outline: none;
}

.cd-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    transition:
        background-color 0.15s,
        box-shadow 0.15s;
}

.cd-resizer:hover::after,
.cd-resizer:focus-visible::after,
.cd-resizer.dragging::after {
    background: var(--ui-color-primary-500);
    box-shadow: 0 0 0 1px var(--ui-color-primary-500);
}
</style>
