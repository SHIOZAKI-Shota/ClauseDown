<script setup lang="ts">
import { todayISO } from '@shared/date'
import { useApp } from '~/stores/app'
import type { Issue } from '@shared/api'
import { withIssueLines } from '@shared/issue-refs'
import { useT } from '~/composables/useT'

export interface SaveRequest {
    message: string
    effectiveDate?: string
    draftName?: string
}

const props = defineProps<{ busy: boolean; branchLabel: string; onMain: boolean; hasHistory: boolean; newDoc: boolean; docTitle: string }>()
const emit = defineEmits<{ close: []; save: [SaveRequest] }>()
const t = useT()
const message = ref('')
const withDate = ref(false)
const date = ref(todayISO())
const target = ref<'here' | 'draft'>(props.newDoc ? 'draft' : 'here')
const draftName = ref(props.newDoc ? t.value.history.save.defaultDraftName(props.docTitle) : '')

const app = useApp()
const aiReady = ref(false)
const drafting = ref(false)
const openIssues = ref<Issue[]>([])
onMounted(async () => {
    aiReady.value = (await window.api.aiStatus().catch(() => null))?.ready ?? false
    if (app.repoDir) openIssues.value = (await window.api.listIssues(app.repoDir).catch(() => [])).filter((i) => i.state === 'open')
})

const picked = ref<{ n: number; how: 'close' | 'ref' }[]>([])
const toDraft = computed(() => !props.onMain || target.value === 'draft')
const pickable = computed(() =>
    openIssues.value.filter((i) => !picked.value.some((p) => p.n === i.n)).map((i) => ({ label: `#${i.n} ${i.title}`, value: i.n })),
)
const titleOf = (n: number) => openIssues.value.find((i) => i.n === n)?.title ?? ''
function pick(n: number | undefined) {
    if (n) picked.value.push({ n, how: 'close' })
}
const unpick = (n: number) => (picked.value = picked.value.filter((p) => p.n !== n))
const flip = (p: { how: 'close' | 'ref' }) => (p.how = p.how === 'close' ? 'ref' : 'close')

const box = ref<HTMLElement | null>(null)
const hint = ref<{ from: number; word: string } | null>(null)
const hintAt = ref(0)
const area = () => box.value?.querySelector('textarea') ?? null
const hints = computed(() => {
    const h = hint.value
    if (!h) return []
    return openIssues.value.filter((i) => !h.word || String(i.n).startsWith(h.word) || i.title.includes(h.word)).slice(0, 6)
})
function onType() {
    const el = area()
    if (!el) return
    const before = el.value.slice(0, el.selectionStart)
    const m = /(^|[^\w&#/])#(\S{0,20})$/.exec(before)
    hint.value = m ? { from: before.length - m[2].length - 1, word: m[2] } : null
    hintAt.value = 0
}
function useHint(i: Issue) {
    const el = area()
    const h = hint.value
    if (!el || !h) return
    const end = el.selectionStart
    message.value = `${message.value.slice(0, h.from)}#${i.n} ${message.value.slice(end)}`
    hint.value = null
    const caret = h.from + String(i.n).length + 2
    void nextTick(() => {
        el.focus()
        el.setSelectionRange(caret, caret)
    })
}
function onKey(e: KeyboardEvent) {
    if (!hints.value.length || e.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        hintAt.value = (hintAt.value + (e.key === 'ArrowDown' ? 1 : hints.value.length - 1)) % hints.value.length
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        useHint(hints.value[hintAt.value])
    } else if (e.key === 'Escape') {
        hint.value = null
    } else return
    e.preventDefault()
    e.stopPropagation()
}
async function draftMessage() {
    if (!app.repoDir) return
    await app.flushEditor()
    drafting.value = true
    const text = await app.run(() => window.api.suggestVersionMessage(app.repoDir!))
    drafting.value = false
    if (text) message.value = text
}

const canSave = computed(() => !!message.value.trim() && !props.busy && (target.value === 'here' || !!draftName.value.trim()))

function save() {
    if (!canSave.value) return
    emit('save', {
        message: withIssueLines(
            message.value.trim(),
            picked.value.filter((p) => p.how === 'close').map((p) => p.n),
            picked.value.filter((p) => p.how === 'ref').map((p) => p.n),
        ),
        effectiveDate: withDate.value && target.value === 'here' ? date.value : undefined,
        draftName: target.value === 'draft' ? draftName.value.trim() : undefined,
    })
}
</script>

<template>
    <UModal :open="true" :title="t.history.save.title" :description="t.history.save.description" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField v-if="onMain" :label="t.history.save.target">
                    <SegmentSwitch
                        v-model="target"
                        :aria-label="t.history.save.target"
                        :items="
                            !newDoc
                                ? [
                                      {
                                          value: 'here',
                                          label: t.history.save.toCurrent,
                                          icon: 'i-lucide-badge-check',
                                          description: t.history.save.toCurrentDesc,
                                      },
                                      {
                                          value: 'draft',
                                          label: t.history.save.newDraft,
                                          icon: 'i-lucide-git-branch',
                                          description: t.history.save.newDraftDesc,
                                      },
                                  ]
                                : [
                                      {
                                          value: 'draft',
                                          label: t.history.save.asDraft,
                                          icon: 'i-lucide-git-branch',
                                          description: t.history.save.asDraftDesc,
                                      },
                                      {
                                          value: 'here',
                                          label: hasHistory ? t.history.save.toCurrent : t.history.save.asCurrent,
                                          icon: 'i-lucide-badge-check',
                                          description: t.history.save.asCurrentDesc,
                                      },
                                  ]
                        "
                    />
                </UFormField>
                <UFormField v-if="target === 'draft'" :label="t.history.save.draftName" :description="t.history.save.draftNameExample">
                    <UInput v-model="draftName" class="cd-full" />
                </UFormField>
                <UAlert v-if="!onMain" color="warning" variant="subtle" icon="i-lucide-file-pen-line" :title="t.history.save.savingToDraft(branchLabel)" />
                <UFormField :label="t.history.save.whatChanged" :description="t.history.save.whatChangedExample">
                    <template v-if="aiReady" #hint>
                        <UButton
                            :label="t.history.save.aiDraft"
                            icon="i-lucide-sparkles"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            :loading="drafting"
                            :title="t.history.save.aiDraftTitle"
                            @click="draftMessage"
                        />
                    </template>
                    <div ref="box" class="msg-box" @keydown.capture="onKey">
                        <UTextarea v-model="message" :rows="3" class="cd-full" autofocus @input="onType" @click="onType" @blur="hint = null" />
                        <div v-if="hints.length" class="hints" role="listbox">
                            <button v-for="(i, k) in hints" :key="i.n" type="button" class="hint" :class="{ on: k === hintAt }" @mousedown.prevent="useHint(i)">
                                <span class="num">#{{ i.n }}</span>{{ i.title }}
                            </button>
                        </div>
                    </div>
                </UFormField>
                <UFormField
                    v-if="openIssues.length"
                    :label="t.history.save.issues"
                    :description="toDraft ? t.history.save.closeOnMerge : t.history.save.closeOnSave"
                >
                    <div class="issues">
                        <div v-for="p in picked" :key="p.n" class="chip">
                            <UButton
                                :label="p.how === 'close' ? t.history.save.closes : t.history.save.relates"
                                size="xs"
                                :color="p.how === 'close' ? 'primary' : 'neutral'"
                                variant="soft"
                                :title="t.history.save.toggleHow"
                                @click="flip(p)"
                            />
                            <span class="num">#{{ p.n }}</span><span class="ttl">{{ titleOf(p.n) }}</span>
                            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="t.history.save.unpick" @click="unpick(p.n)" />
                        </div>
                        <USelectMenu
                            v-if="pickable.length"
                            :key="picked.length"
                            :model-value="undefined"
                            :items="pickable"
                            value-key="value"
                            size="sm"
                            :placeholder="t.history.save.pickIssue"
                            icon="i-lucide-list-todo"
                            class="cd-full"
                            :search-input="{ placeholder: t.history.save.searchIssue }"
                            @update:model-value="pick"
                        />
                    </div>
                </UFormField>
                <div v-if="target === 'here'" class="row">
                    <UCheckbox v-model="withDate" :label="t.history.save.recordEffective" data-guide="effective" />
                    <DateField v-if="withDate" v-model="date" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="t.common.save" :disabled="!canSave" :loading="busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.msg-box {
    position: relative;
}

.hints {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    z-index: 10;
    margin-top: 2px;
    padding: 4px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-bg);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}

.hint {
    display: flex;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
}

.hint.on,
.hint:hover {
    background: var(--ui-bg-elevated);
}

.issues {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.chip {
    display: flex;
    align-items: center;
    gap: 6px;
}

.num {
    color: var(--ui-text-muted);
}

.chip .ttl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.row {
    display: flex;
    gap: 12px;
    align-items: center;
}
</style>
