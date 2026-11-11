<script setup lang="ts">
import { todayISO } from '~/utils/format'
import { useApp } from '~/stores/app'
import type { Issue } from '@shared/api'
import { withIssueLines } from '@shared/issue-refs'

export interface SaveRequest {
    message: string
    effectiveDate?: string
    draftName?: string
}

const props = defineProps<{ busy: boolean; branchLabel: string; onMain: boolean; hasHistory: boolean; newDoc: boolean; docTitle: string }>()
const emit = defineEmits<{ close: []; save: [SaveRequest] }>()
const message = ref('')
const withDate = ref(false)
const date = ref(todayISO())
const target = ref<'here' | 'draft'>(props.newDoc ? 'draft' : 'here')
const draftName = ref(props.newDoc ? `${props.docTitle}の作成` : '')

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

const canSave = computed(
    () => !!message.value.trim() && !props.busy && (target.value === 'here' || !!draftName.value.trim()),
)

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
    <UModal :open="true" title="版を保存"
        description="今の内容を一つの版として記録します（リモートがあれば、設定に従って送信します）。あとから改定履歴で見返したり、新旧対照表を作ったりできます。"
        @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField v-if="onMain" label="保存先">
                    <SegmentSwitch v-model="target" aria-label="保存先" :items="!newDoc ? [
                        { value: 'here', label: '現行版に保存', icon: 'i-lucide-badge-check', description: 'すぐに正式な版になります。誤字の修正など、確認がいらない変更に' },
                        { value: 'draft', label: '新しい改定案として保存', icon: 'i-lucide-git-branch', description: '現行版はそのまま。確認が済んだら「現行版に反映」します' },
                    ] : [
                        { value: 'draft', label: '改定案として保存', icon: 'i-lucide-git-branch', description: '書きかけのまま区切りごとに保存できます。完成して確認が済んだら「現行版に反映」します' },
                        { value: 'here', label: hasHistory ? '現行版に保存' : '現行版として保存', icon: 'i-lucide-badge-check', description: 'すでに完成している内容を、そのまま現行版に入れます' },
                    ]" />
                </UFormField>
                <UFormField v-if="target === 'draft'" label="改定案の名前" description="例：2026年4月改定">
                    <UInput v-model="draftName" class="cd-full" />
                </UFormField>
                <UAlert v-if="!onMain" color="warning" variant="subtle" icon="i-lucide-file-pen-line"
                    :title="`保存先：改定案「${branchLabel}」（現行版には影響しません）`" />
                <UFormField label="何を変えたか" description="例：第12条 契約期間を2年に変更">
                    <template v-if="aiReady" #hint>
                        <UButton label="AI で下書き" icon="i-lucide-sparkles" size="xs" color="neutral" variant="ghost"
                            :loading="drafting" title="保存していない変更を AI に渡して、説明を作ります" @click="draftMessage" />
                    </template>
                    <div ref="box" class="msg-box" @keydown.capture="onKey">
                        <UTextarea v-model="message" :rows="3" class="cd-full" autofocus @input="onType" @click="onType"
                            @blur="hint = null" />
                        <div v-if="hints.length" class="hints" role="listbox">
                            <button v-for="(i, k) in hints" :key="i.n" type="button" class="hint"
                                :class="{ on: k === hintAt }" @mousedown.prevent="useHint(i)">
                                <span class="num">#{{ i.n }}</span>{{ i.title }}
                            </button>
                        </div>
                    </div>
                </UFormField>
                <UFormField v-if="openIssues.length" label="課題"
                    :description="toDraft ? '「解決する」課題は、この改定案を現行版に反映したときに閉じます。' : '「解決する」課題は、保存すると閉じます。'">
                    <div class="issues">
                        <div v-for="p in picked" :key="p.n" class="chip">
                            <UButton :label="p.how === 'close' ? '解決する' : '関連する'" size="xs"
                                :color="p.how === 'close' ? 'primary' : 'neutral'" variant="soft"
                                title="押すと「解決する」と「関連する」を切り替えます" @click="flip(p)" />
                            <span class="num">#{{ p.n }}</span><span class="ttl">{{ titleOf(p.n) }}</span>
                            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" aria-label="外す"
                                @click="unpick(p.n)" />
                        </div>
                        <USelectMenu v-if="pickable.length" :key="picked.length" :model-value="undefined"
                            :items="pickable" value-key="value" size="sm" placeholder="課題を選ぶ…" icon="i-lucide-list-todo"
                            class="cd-full" :search-input="{ placeholder: '番号・題名で探す' }" @update:model-value="pick" />
                    </div>
                </UFormField>
                <div v-if="target === 'here'" class="row">
                    <UCheckbox v-model="withDate" label="施行日を記録する" />
                    <DateField v-if="withDate" v-model="date" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="保存" :disabled="!canSave" :loading="busy" @click="save" />
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
