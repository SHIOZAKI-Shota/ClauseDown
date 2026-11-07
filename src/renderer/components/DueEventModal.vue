<script setup lang="ts">
import { KIND_COLORS, type DueEvent, type DueEventInput, type EventKind, type RepoSchedule } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { todayISO } from '~/utils/format'

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
    { label: 'リポジトリ全体', value: ALL },
    ...docList.value.map((d) => ({ label: d.title, value: d.path, description: d.path })),
])
watch(dir, () => {
    if (!docList.value.some((d) => d.path === docPath.value)) docPath.value = ALL
    if (!kindList.value.some((k) => k.id === kind.value)) kind.value = kindList.value[0]?.id ?? ''
})
const remindItems = computed(() => {
    const k = kindNow.value
    const label = (n: number) => (n < 0 ? '知らせない' : n === 0 ? '当日' : `${n} 日前`)
    return [
        { label: `種類の既定（${k ? label(k.remind) : '—'}）`, value: 'kind' },
        ...[0, 1, 3, 7, 14, 30, 60, 90].map((n) => ({ label: label(n), value: String(n) })),
        { label: '知らせない', value: '-1' },
    ]
})
watch(date, (d) => {
    if (end.value < d) end.value = d
})

const error = computed(() => {
    if (!dir.value) return 'リポジトリを選んでください'
    if (!kind.value) return '種類を選んでください'
    if (!date.value) return '日付を入れてください'
    if (isRange.value && end.value < date.value) return '終了日は開始日以降にしてください'
    if (repeat.value !== 'none' && until.value && until.value < date.value) return '繰り返しの終わりは開始日以降にしてください'
    return ''
})

function save() {
    if (error.value) return
    emit('save', {
        ...(e ? { id: e.id } : {}),
        kind: kind.value,
        docPath: docPath.value === ALL ? '' : docPath.value,
        date: date.value,
        ...(isRange.value && end.value > date.value ? { end: end.value } : {}),
        ...(repeat.value !== 'none' ? { repeat: { every: repeat.value, ...(until.value ? { until: until.value } : {}) } } : {}),
        ...(remind.value !== 'kind' ? { remind: Number(remind.value) } : {}),
        ...(title.value.trim() ? { title: title.value.trim() } : {}),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
    }, dir.value)
}
</script>

<template>
    <UModal :open="true" :title="event ? '期日を直す' : '期日を足す'"
        description="施行・公布・提出・届出・契約の開始や更新などの日付を記録します。リポジトリを使う全員に共有されます。" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField v-if="repoChoices && !event" label="リポジトリ">
                    <USelect v-model="dir" :items="repoItems" class="cd-full" />
                </UFormField>
                <UFormField label="種類">
                    <div class="kinds" role="radiogroup" aria-label="種類">
                        <button v-for="k in kindList" :key="k.id" type="button" role="radio" class="kind"
                            :class="{ on: kind === k.id }" :aria-checked="kind === k.id"
                            :style="{ '--k': KIND_COLORS[k.color] }" @click="kind = k.id">{{ k.label }}</button>
                    </div>
                </UFormField>
                <UFormField label="名前" description="空欄なら種類の名前（例：更新）を使います">
                    <UInput v-model="title" class="cd-full" :placeholder="kindNow ? `例：${kindNow.label}（〇〇宛て）` : ''" />
                </UFormField>
                <UFormField label="対象">
                    <USelectMenu v-model="docPath" :items="docItems" value-key="value" :disabled="fixedDoc"
                        class="cd-full" />
                </UFormField>

                <div class="dates">
                    <UFormField :label="isRange ? '開始日' : '日付'">
                        <DateField v-model="date" />
                    </UFormField>
                    <UFormField v-if="isRange" label="終了日">
                        <DateField v-model="end" :min="date" />
                    </UFormField>
                    <USwitch v-model="isRange" label="期間にする" class="sw" />
                </div>

                <UFormField label="繰り返し">
                    <div class="dates">
                        <SegmentSwitch v-model="repeat" aria-label="繰り返し" :items="[
                            { value: 'none', label: 'なし' },
                            { value: 'year', label: '毎年' },
                            { value: 'month', label: '毎月' },
                        ]" />
                        <template v-if="repeat !== 'none'">
                            <span class="cd-muted">終わり</span>
                            <DateField v-model="until" :min="date" />
                            <span v-if="!until" class="cd-muted">（なし）</span>
                        </template>
                    </div>
                </UFormField>

                <UFormField label="知らせる" :description="kindNow?.task ? '済みにするまで、期限を過ぎても知らせます' : ''">
                    <USelect v-model="remind" :items="remindItems" class="cd-w-input" />
                </UFormField>
                <UFormField label="メモ">
                    <UTextarea v-model="note" :rows="2" autoresize class="cd-full" />
                </UFormField>
                <UAlert v-if="error" color="warning" variant="subtle" :title="error" />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot foot">
                <UButton v-if="event" label="消す" icon="i-lucide-trash-2" color="error" variant="ghost" class="del"
                    @click="emit('remove', event.id, dir)" />
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="event ? '保存' : '足す'" :disabled="!!error" :loading="app.busy" @click="save" />
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

.dates>.cd-muted {
    align-self: center;
}

.sw {
    margin-bottom: 8px;
}

.foot .del {
    margin-right: auto;
}
</style>
