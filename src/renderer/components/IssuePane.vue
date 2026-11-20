<script setup lang="ts">
import type { LegalDoc } from '@shared/legal-parser'
import { positionLabel } from '~/utils/legal-editor'
import { useVerticalResize } from '~/composables/useVerticalResize'
import { useT } from '~/composables/useT'

export interface EditorIssue {
    from: number
    to: number
    line: number
    severity: 'error' | 'warning'
    message: string
    source?: string
}

const props = defineProps<{ items: EditorIssue[]; doc: LegalDoc; active: number | null }>()
const filter = defineModel<'all' | 'error' | 'warning'>('filter', { default: 'all' })
const emit = defineEmits<{ pick: [EditorIssue]; close: [] }>()
const t = useT()

const { height, dragging, down, move, up, reset } = useVerticalResize('clausedown.pane.issues', 180, { min: 80, max: () => 600, grow: 'up' })
const errors = computed(() => props.items.filter((i) => i.severity === 'error').length)
const warnings = computed(() => props.items.length - errors.value)
const shown = computed(() => (filter.value === 'all' ? props.items : props.items.filter((i) => i.severity === filter.value)))
const FILTERS = computed(() => [
    { value: 'all' as const, label: t.value.editor.issues.all(props.items.length) },
    { value: 'error' as const, label: t.value.editor.issues.error(errors.value) },
    { value: 'warning' as const, label: t.value.editor.issues.warning(warnings.value) },
])

const list = ref<HTMLElement>()
watch(
    () => props.active,
    async () => {
        await nextTick()
        list.value?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    },
)
</script>

<template>
    <section class="issues" :style="{ height: `${height}px` }">
        <div
            class="grip"
            :class="{ dragging }"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t.editor.issues.resize"
            @pointerdown="down"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
            @dblclick="reset"
        />
        <div class="cd-pane-bar">
            <span class="cd-pane-title">{{ t.editor.issues.title }}</span>
            <SegmentSwitch v-model="filter" size="xs" :aria-label="t.editor.issues.kind" :items="FILTERS" data-guide="proofread" />
            <UTooltip :text="t.editor.issues.close">
                <UButton
                    icon="i-lucide-panel-bottom-close"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    :aria-label="t.editor.issues.close"
                    @click="emit('close')"
                />
            </UTooltip>
        </div>
        <div ref="list" class="list">
            <button
                v-for="(it, i) in shown"
                :key="`${it.from}:${it.to}:${i}`"
                class="row"
                :class="[it.severity, { on: active === it.from }]"
                @click="emit('pick', it)"
            >
                <UIcon :name="it.severity === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'" class="mark" />
                <span class="msg">{{ it.message }}</span>
                <span class="where">{{
                    [positionLabel(doc, it.line) || t.editor.issues.line(it.line + 1), it.source].filter(Boolean).join(t.editor.issues.sep)
                }}</span>
            </button>
            <p v-if="!shown.length" class="empty">{{ t.editor.issues.empty }}</p>
        </div>
    </section>
</template>

<style scoped>
.issues {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
    border-top: 1px solid var(--ui-border);
    background: var(--cd-sidebar);
}

.grip {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    z-index: 2;
    cursor: row-resize;
}

.grip:hover,
.grip.dragging {
    background: color-mix(in oklab, var(--ui-color-primary-500) 40%, transparent);
}

.list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0;
}

.row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 3px 12px;
    text-align: left;
    font-size: 12px;
    cursor: pointer;
}

.row:hover {
    background: var(--ui-bg-elevated);
}

.row.on {
    background: var(--ui-bg-accented);
}

.mark {
    flex-shrink: 0;
    width: 13px;
    height: 13px;
    align-self: center;
}

.row.error .mark {
    color: var(--cd-syn-ref-bad);
}

.row.warning .mark {
    color: var(--cd-draft);
}

.msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.where {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.empty {
    padding: 12px;
    font-size: 12px;
    color: var(--ui-text-muted);
}
</style>
