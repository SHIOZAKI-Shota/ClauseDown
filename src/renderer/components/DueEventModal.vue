<script setup lang="ts">
import { KIND_COLORS, type DueEvent, type DueEventInput, type EventKind, type RepoSchedule } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { todayISO } from '@shared/date'
import { useT } from '~/composables/useT'

const props = defineProps<{
    kinds: EventKind[]
    event?: DueEvent
    initial?: { date?: string; docPath?: string; kind?: string }
    fixedDoc?: boolean
    repoChoices?: RepoSchedule[]
    dir?: string
}>()
const emit = defineEmits<{ close: []; save: [DueEventInput, string]; remove: [string, string] }>()
const app = useApp()
const t = useT()
const dir = ref(props.dir ?? props.repoChoices?.[0]?.dir ?? app.repoDir ?? '')
const choice = computed(() => props.repoChoices?.find((r) => r.dir === dir.value))
const kindList = computed(() => choice.value?.kinds ?? props.kinds)
const docList = computed(() => choice.value?.docs ?? app.docs)
const repoItems = computed(() => (props.repoChoices ?? []).map((r) => ({ label: r.name, value: r.dir })))

const ALL = '__all__'
const e = props.event
const kind = ref(e?.kind ?? props.initial?.kind ?? kindList.value.find((k) => k.id !== 'effective')?.id ?? kindList.value[0]?.id ?? '')
const docPath = ref((e ? e.docPath : props.initial?.docPath) || ALL)
const date = ref(e?.date ?? props.initial?.date ?? todayISO())
const isRange = ref(!!e?.end)
const end = ref(e?.end ?? date.value)
const repeat = ref<'none' | 'year' | 'month'>(e?.repeat?.every ?? 'none')
const until = ref(e?.repeat?.until ?? '')
const remind = ref(e?.remind === undefined ? 'kind' : String(e.remind))
const title = ref(e?.title ?? '')
const note = ref(e?.note ?? '')

const kindNow = computed(() => kindList.value.find((k) => k.id === kind.value))
const docItems = computed(() => [
    { label: t.value.schedule.wholeRepo, value: ALL },
    ...docList.value.map((d) => ({ label: d.title, value: d.path, description: d.path })),
])
watch(dir, () => {
    if (!docList.value.some((d) => d.path === docPath.value)) docPath.value = ALL
    if (!kindList.value.some((k) => k.id === kind.value)) kind.value = kindList.value[0]?.id ?? ''
})
const remindItems = computed(() => {
    const k = kindNow.value
    const s = t.value.schedule
    return [
        { label: s.modal.kindDefault(k ? s.remindShort(k.remind) : '—'), value: 'kind' },
        ...[0, 1, 3, 7, 14, 30, 60, 90].map((n) => ({ label: s.remindShort(n), value: String(n) })),
        { label: s.remindNever, value: '-1' },
    ]
})
watch(date, (d) => {
    if (end.value < d) end.value = d
})

const error = computed(() => {
    const m = t.value.schedule.modal
    if (!dir.value) return m.errRepo
    if (!kind.value) return m.errKind
    if (!date.value) return m.errDate
    if (isRange.value && end.value < date.value) return m.errEnd
    if (repeat.value !== 'none' && until.value && until.value < date.value) return m.errUntil
    return ''
})

function save() {
    if (error.value) return
    emit(
        'save',
        {
            ...(e ? { id: e.id } : {}),
            kind: kind.value,
            docPath: docPath.value === ALL ? '' : docPath.value,
            date: date.value,
            ...(isRange.value && end.value > date.value ? { end: end.value } : {}),
            ...(repeat.value !== 'none' ? { repeat: { every: repeat.value, ...(until.value ? { until: until.value } : {}) } } : {}),
            ...(remind.value !== 'kind' ? { remind: Number(remind.value) } : {}),
            ...(title.value.trim() ? { title: title.value.trim() } : {}),
            ...(note.value.trim() ? { note: note.value.trim() } : {}),
        },
        dir.value,
    )
}
</script>

<template>
    <UModal
        :open="true"
        :title="event ? t.schedule.modal.editTitle : t.schedule.add"
        :description="t.schedule.modal.description"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <div class="cd-form">
                <UFormField v-if="repoChoices && !event" :label="t.schedule.f.repo">
                    <USelect v-model="dir" :items="repoItems" class="cd-full" />
                </UFormField>
                <UFormField :label="t.schedule.modal.kind">
                    <div class="kinds" role="radiogroup" :aria-label="t.schedule.modal.kind">
                        <button
                            v-for="k in kindList"
                            :key="k.id"
                            type="button"
                            role="radio"
                            class="kind"
                            :class="{ on: kind === k.id }"
                            :aria-checked="kind === k.id"
                            :style="{ '--k': KIND_COLORS[k.color] }"
                            @click="kind = k.id"
                        >
                            {{ k.label }}
                        </button>
                    </div>
                </UFormField>
                <UFormField :label="t.schedule.modal.name" :description="t.schedule.modal.nameHelp">
                    <UInput v-model="title" class="cd-full" :placeholder="kindNow ? t.schedule.modal.namePlaceholder(kindNow.label) : ''" />
                </UFormField>
                <UFormField :label="t.schedule.f.target">
                    <USelectMenu v-model="docPath" :items="docItems" value-key="value" :disabled="fixedDoc" class="cd-full" />
                </UFormField>

                <div class="dates">
                    <UFormField :label="isRange ? t.schedule.modal.start : t.schedule.f.date">
                        <DateField v-model="date" />
                    </UFormField>
                    <UFormField v-if="isRange" :label="t.schedule.modal.end">
                        <DateField v-model="end" :min="date" />
                    </UFormField>
                    <USwitch v-model="isRange" :label="t.schedule.modal.isRange" class="sw" />
                </div>

                <UFormField :label="t.schedule.f.repeat">
                    <div class="dates">
                        <SegmentSwitch
                            v-model="repeat"
                            :aria-label="t.schedule.f.repeat"
                            :items="[
                                { value: 'none', label: t.schedule.modal.repeatNone },
                                { value: 'year', label: t.schedule.modal.yearly },
                                { value: 'month', label: t.schedule.modal.monthly },
                            ]"
                        />
                        <template v-if="repeat !== 'none'">
                            <span class="cd-muted">{{ t.schedule.modal.until }}</span>
                            <DateField v-model="until" :min="date" />
                            <span v-if="!until" class="cd-muted">{{ t.schedule.modal.untilNone }}</span>
                        </template>
                    </div>
                </UFormField>

                <UFormField :label="t.schedule.modal.remind" :description="kindNow?.task ? t.schedule.modal.remindTaskHelp : ''">
                    <USelect v-model="remind" :items="remindItems" class="cd-w-input" />
                </UFormField>
                <UFormField :label="t.schedule.f.memo">
                    <UTextarea v-model="note" :rows="2" autoresize class="cd-full" />
                </UFormField>
                <UAlert v-if="error" color="warning" variant="subtle" :title="error" />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot foot">
                <UButton
                    v-if="event"
                    :label="t.schedule.remove"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    class="del"
                    @click="emit('remove', event.id, dir)"
                />
                <UButton :label="t.schedule.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="event ? t.common.save : t.schedule.modal.add" :disabled="!!error" :loading="app.busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--ui-border);
    font-size: 13px;
    cursor: pointer;
}

.kind::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 2px;
    transform: rotate(45deg);
    background: var(--k);
}

.kind:hover {
    border-color: var(--k);
}

.kind.on {
    border-color: var(--k);
    background: color-mix(in oklab, var(--k) 15%, transparent);
    font-weight: 600;
}

.dates {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
}

.dates > .cd-muted {
    align-self: center;
}

.sw {
    margin-bottom: 8px;
}

.foot .del {
    margin-right: auto;
}
</style>
