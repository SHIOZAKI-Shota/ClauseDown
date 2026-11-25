<script setup lang="ts">
import { KIND_COLORS, type EventKind, type Occurrence } from '@shared/schedule'
import { daysUntil, untilLabel } from '~/utils/format'
import { todayISO } from '@shared/date'

const props = defineProps<{
    o: Occurrence
    kind: EventKind
    active?: boolean
    where?: string
}>()
defineEmits<{ click: []; toggle: [] }>()
const t = useT()
const today = todayISO()
const n = computed(() => daysUntil(props.o.date, today))
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`
const when = computed(() => {
    const o = props.o
    const m = t.value.shell.occurrence
    if (o.done) return m.done
    if (o.overdue) return m.overdue(untilLabel(n.value))
    if (o.end && o.date <= today && today <= o.end) return m.during(md(o.end))
    return untilLabel(n.value)
})
</script>

<template>
    <ListRow as="div" :active="active" :dim="o.done" class="occ" :class="{ overdue: o.overdue }" @click="$emit('click')">
        <template #lead>
            <DateTile :date="o.date" :fade-past="!o.overdue" />
        </template>
        <span class="title">{{ o.title }}</span>
        <template #sub>
            <span class="kind" :style="{ '--k': KIND_COLORS[kind.color] }">{{ kind.label }}</span>
            <span v-if="o.end" class="span">{{ t.shell.occurrence.until(md(o.end)) }}</span>
            <UIcon v-if="o.repeat" name="i-lucide-repeat" class="rep" />
            <span class="when">{{ when }}</span>
            <template v-if="where">{{ t.common.sep }}{{ where }}</template>
        </template>
        <template #trail>
            <slot name="trail" />
            <UTooltip v-if="o.task && o.source === 'event'" :text="o.done ? t.shell.occurrence.unmarkDone : t.shell.occurrence.markDone">
                <UCheckbox
                    :model-value="o.done"
                    :aria-label="o.done ? t.shell.occurrence.unmarkDone : t.shell.occurrence.markDone"
                    @click.stop
                    @update:model-value="$emit('toggle')"
                />
            </UTooltip>
        </template>
    </ListRow>
</template>

<style scoped>
.occ {
    cursor: pointer;
}

.title {
    font-weight: 600;
}

.kind {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-right: 6px;
    color: var(--ui-text-toned);
}

.kind::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 2px;
    transform: rotate(45deg);
    background: var(--k);
}

.span {
    margin-right: 6px;
}

.rep {
    width: 11px;
    height: 11px;
    margin-right: 4px;
    vertical-align: -1px;
}

.overdue .when {
    color: var(--ui-color-error-500);
    font-weight: 700;
}

.overdue :deep(.tile) {
    border-color: var(--ui-color-error-500);
}
</style>
