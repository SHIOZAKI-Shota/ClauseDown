<script setup lang="ts">
import { diffChars } from 'diff'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Conflict, ConflictChoice } from '@shared/api'
import { linesFor, merge3, type Hunk, type HunkChoice, type MergeResult } from '@shared/merge3'
import { parseLegal } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { useApp } from '~/stores/app'

const app = useApp()
const props = defineProps<{ conflicts: Conflict[]; oursLabel: string; theirsLabel: string }>()
const choices = defineModel<Record<string, ConflictChoice>>({ required: true })

interface FileState {
    merge: MergeResult | null
    text: Record<number, string | undefined>
    picked: Record<number, HunkChoice | undefined>
    override: string | null
    keep: 'ours' | 'theirs' | 'delete' | null
}

const state = reactive<Record<string, FileState>>({})
for (const c of props.conflicts) {
    state[c.path] = {
        merge: c.oursDeleted || c.theirsDeleted ? null : merge3(c.base, c.ours, c.theirs),
        text: {},
        picked: {},
        override: null,
        keep: null,
    }
}

interface Spot {
    path: string
    hunk: Hunk | null
    label: string
}
const spots = computed<Spot[]>(() =>
    props.conflicts.flatMap((c): Spot[] => {
        const m = state[c.path].merge
        if (!m) return [{ path: c.path, hunk: null, label: c.oursDeleted ? `${props.oursLabel}で削除` : `${props.theirsLabel}で削除` }]
        return m.hunks.map((h) => ({ path: c.path, hunk: h, label: h.where }))
    }),
)
const index = ref(0)
const spot = computed(() => spots.value[index.value])
const fs = computed(() => state[spot.value.path])
const conflict = computed(() => props.conflicts.find((c) => c.path === spot.value.path)!)

const isResolved = (s: Spot) => {
    const st = state[s.path]
    if (!s.hunk) return st.keep !== null
    return st.override !== null || st.text[s.hunk.id] !== undefined
}
const remaining = computed(() => spots.value.filter((s) => !isResolved(s)).length)
defineExpose({ remaining })

function go(delta: number) {
    index.value = Math.min(spots.value.length - 1, Math.max(0, index.value + delta))
}
function nextUnresolved() {
    const n = spots.value.length
    for (let i = 1; i <= n; i++) {
        const j = (index.value + i) % n
        if (!isResolved(spots.value[j])) return (index.value = j)
    }
}

const showBase = ref(false)
const current = computed({
    get: () => (spot.value.hunk ? (fs.value.text[spot.value.hunk.id] ?? '') : ''),
    set: (v: string) => {
        if (!spot.value.hunk) return
        fs.value.text[spot.value.hunk.id] = v
        fs.value.picked[spot.value.hunk.id] = 'custom'
    },
})
function pick(choice: HunkChoice) {
    const h = spot.value.hunk
    if (!h) return
    fs.value.text[h.id] = linesFor(h, choice).join('\n')
    fs.value.picked[h.id] = choice
}
function clear() {
    const h = spot.value.hunk
    if (!h) return
    fs.value.text[h.id] = undefined
    fs.value.picked[h.id] = undefined
}
const picked = computed(() => (spot.value.hunk ? fs.value.picked[spot.value.hunk.id] : undefined))
const bothMenu = computed<DropdownMenuItem[]>(() => [
    { label: `${props.oursLabel} → ${props.theirsLabel} の順`, onSelect: () => pick('oursThenTheirs') },
    { label: `${props.theirsLabel} → ${props.oursLabel} の順`, onSelect: () => pick('theirsThenOurs') },
])

function build(path: string): { text: string; at: Record<number, number>; complete: boolean } {
    const st = state[path]
    const c = props.conflicts.find((x) => x.path === path)!
    if (!st.merge) {
        const text = st.keep === 'theirs' ? c.theirs : st.keep === 'ours' ? c.ours : ''
        return { text, at: {}, complete: st.keep !== null }
    }
    if (st.override !== null) return { text: st.override, at: {}, complete: true }
    const out: string[] = []
    const at: Record<number, number> = {}
    let complete = true
    for (const p of st.merge.parts) {
        if (p.kind === 'ok') out.push(...p.lines)
        else {
            at[p.hunk.id] = out.length
            const t = st.text[p.hunk.id]
            if (t === undefined) {
                complete = false
                out.push(...p.hunk.ours)
            } else out.push(...(t === '' ? [] : t.split('\n')))
        }
    }
    return { text: out.join('\n'), at, complete }
}

watch(
    state,
    () => {
        const next: Record<string, ConflictChoice> = {}
        for (const c of props.conflicts) {
            const st = state[c.path]
            if (!st.merge && st.keep === 'delete') next[c.path] = { content: null }
            else {
                const b = build(c.path)
                if (b.complete) next[c.path] = { content: b.text }
            }
        }
        choices.value = next
    },
    { deep: true, immediate: true },
)

const result = computed(() => build(spot.value.path))
const resultView = ref<'preview' | 'text'>('preview')
const previewHtml = computed(() => withImages(renderDoc(parseLegal(result.value.text)), app.repoDir, spot.value.path))
const fullText = computed({
    get: () => result.value.text,
    set: (v: string) => (fs.value.override = v),
})

const preview = ref<HTMLElement>()
watch(
    [spot, previewHtml],
    async () => {
        await nextTick()
        const host = preview.value
        const h = spot.value.hunk
        if (!host || !h) return
        const line = result.value.at[h.id]
        host.querySelectorAll('.cd-active').forEach((el) => el.classList.remove('cd-active'))
        if (line === undefined) return
        let best: HTMLElement | null = null
        for (const el of host.querySelectorAll<HTMLElement>('[data-line]')) {
            if (Number(el.dataset.line) <= line) best = el
            else break
        }
        best?.classList.add('cd-active')
        best?.scrollIntoView({ block: 'center' })
    },
    { flush: 'post' },
)

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
function marked(lines: string[], base: string[]): string {
    if (!lines.length) return '<span class="none">（削除）</span>'
    return diffChars(base.join('\n'), lines.join('\n'))
        .filter((p) => !p.removed)
        .map((p) => (p.added ? `<u>${esc(p.value)}</u>` : esc(p.value)))
        .join('')
}
const plain = (lines: string[]) => (lines.length ? esc(lines.join('\n')) : '<span class="none">（なし）</span>')
</script>

<template>
    <div class="cr">
        <aside class="side">
            <div class="cd-pane-head">
                <span>重なった箇所</span>
                <span class="count">{{ spots.length - remaining }} / {{ spots.length }}</span>
            </div>
            <div class="side-list">
                <template v-for="(s, i) in spots" :key="i">
                    <div v-if="i === 0 || spots[i - 1].path !== s.path" class="doc">{{ s.path.replace(/\.md$/, '') }}
                    </div>
                    <button :class="{ on: i === index }" @click="index = i">
                        <UIcon :name="isResolved(s) ? 'i-lucide-check' : 'i-lucide-dot'"
                            :class="['mark', { done: isResolved(s) }]" />
                        <span class="label">{{ s.label }}</span>
                    </button>
                </template>
            </div>
        </aside>

        <section class="center">
            <div class="cd-toolbar toolbar">
                <UFieldGroup size="sm">
                    <UButton icon="i-lucide-chevron-up" color="neutral" variant="outline" square :disabled="index === 0"
                        @click="go(-1)" />
                    <UButton icon="i-lucide-chevron-down" color="neutral" variant="outline" square
                        :disabled="index === spots.length - 1" @click="go(1)" />
                </UFieldGroup>
                <span class="where">{{ spot.label }}</span>
                <span class="cd-grow" />
                <template v-if="spot.hunk">
                    <UFieldGroup size="sm">
                        <UButton :label="oursLabel" color="neutral" :variant="picked === 'ours' ? 'soft' : 'outline'"
                            @click="pick('ours')" />
                        <UButton :label="theirsLabel" color="neutral"
                            :variant="picked === 'theirs' ? 'soft' : 'outline'" @click="pick('theirs')" />
                        <UDropdownMenu :items="bothMenu">
                            <UButton label="両方" trailing-icon="i-lucide-chevron-down" color="neutral"
                                :variant="picked === 'oursThenTheirs' || picked === 'theirsThenOurs' ? 'soft' : 'outline'" />
                        </UDropdownMenu>
                        <UButton label="元の版" color="neutral" :variant="picked === 'base' ? 'soft' : 'outline'"
                            @click="pick('base')" />
                    </UFieldGroup>
                </template>
            </div>

            <div class="center-body">
                <div v-if="!spot.hunk" class="deleted">
                    <p>
                        {{ conflict.oursDeleted ? oursLabel : theirsLabel }}ではこの文書を削除し、{{ conflict.oursDeleted ?
                            theirsLabel :
                            oursLabel }}では書き直しています。
                    </p>
                    <SegmentSwitch :model-value="fs.keep ?? undefined" aria-label="この文書をどうするか" :items="[
                        { value: conflict.oursDeleted ? 'theirs' : 'ours', label: `文書を残す（${conflict.oursDeleted ? theirsLabel : oursLabel}の内容）`, icon: 'i-lucide-file-check' },
                        { value: 'delete', label: '文書を削除する', icon: 'i-lucide-file-x' },
                    ]" @update:model-value="(v) => (fs.keep = v as FileState['keep'])" />
                </div>

                <template v-else>
                    <table class="cmp">
                        <thead>
                            <tr>
                                <th v-if="showBase">元の版</th>
                                <th>{{ oursLabel }}</th>
                                <th>{{ theirsLabel }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td v-if="showBase" class="base">
                                    <pre v-html="plain(spot.hunk.base)" />
                                </td>
                                <td>
                                    <pre v-html="marked(spot.hunk.ours, spot.hunk.base)" />
                                </td>
                                <td>
                                    <pre v-html="marked(spot.hunk.theirs, spot.hunk.base)" />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="sub">
                        <span class="hint">下線は元の版から変わった文字</span>
                        <UButton :label="showBase ? '元の版を隠す' : '元の版を表示'" size="xs" color="neutral" variant="link"
                            @click="showBase = !showBase" />
                    </div>

                    <div class="out-head">
                        <span>統合後</span>
                        <span class="cd-grow" />
                        <UButton v-if="current !== '' || picked" label="やり直す" size="xs" color="neutral" variant="link"
                            @click="clear" />
                    </div>
                    <textarea v-model="current" class="out" spellcheck="false" :placeholder="`上のボタンで選ぶか、ここに直接書いてください`"
                        :rows="Math.max(4, current.split('\n').length + 1)" />
                </template>
            </div>
        </section>

        <section class="right">
            <div class="cd-toolbar toolbar">
                <span class="where">統合結果</span>
                <span class="cd-grow" />
                <SegmentSwitch v-model="resultView" aria-label="統合結果の表示" :items="[
                    { value: 'preview', icon: 'i-lucide-book-open', tooltip: '条文で見る' },
                    { value: 'text', icon: 'i-lucide-square-pen', tooltip: '全文を直す' },
                ]" />
            </div>
            <div v-if="resultView === 'preview'" ref="preview" class="right-body cd-canvas">
                <div class="paper cd-paper" v-html="previewHtml" />
            </div>
            <div v-else class="right-body text">
                <textarea v-model="fullText" class="out full" spellcheck="false" :disabled="!fs.merge" />
                <div v-if="fs.override !== null" class="sub">
                    <span class="hint">全文を直しています（各箇所の選択より優先）</span>
                    <UButton label="取り消す" size="xs" color="neutral" variant="link" @click="fs.override = null" />
                </div>
            </div>
        </section>

        <footer class="cd-statusbar status">
            <span>{{ conflict.path }}</span>
            <span>重なり {{ index + 1 }} / {{ spots.length }}</span>
            <span class="cd-grow" />
            <span v-if="remaining" class="left">未解決 {{ remaining }} か所</span>
            <span v-else class="done">
                <UIcon name="i-lucide-circle-check" />すべて解決しました
            </span>
            <UButton v-if="remaining" label="次の未解決へ" size="xs" color="neutral" variant="link" @click="nextUnresolved" />
        </footer>
    </div>
</template>

<style scoped>
.cr {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr) minmax(0, 0.9fr);
    grid-template-rows: minmax(0, 1fr) 26px;
    height: 100%;
    min-height: 0;
    border-top: 1px solid var(--ui-border);
}

.side,
.center,
.right {
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.center {
    border-left: 1px solid var(--ui-border);
    border-right: 1px solid var(--ui-border);
}

.status {
    grid-column: 1 / -1;
}

.side {
    background: var(--cd-sidebar);
}

.count {
    font-weight: 400;
}

.side-list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.doc {
    margin-top: 8px;
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 700;
    color: var(--cd-syn-chapter);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.side-list button {
    display: flex;
    gap: 6px;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--ui-text-toned);
    cursor: pointer;
}

.side-list button:hover {
    background: var(--ui-bg-accented);
}

.side-list button.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
}

.mark {
    flex-shrink: 0;
    color: var(--cd-draft);
}

.mark.done {
    color: var(--ui-text-dimmed);
}

.label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.toolbar {
    gap: 8px;
    min-height: 45px;
    flex-wrap: nowrap;
}

.where {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.center-body {
    flex: 1;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.cmp {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

.cmp th,
.cmp td {
    border: 1px solid var(--ui-border-accented);
    padding: 6px 10px;
    vertical-align: top;
    text-align: left;
}

.cmp th {
    font-weight: 400;
    font-size: 12px;
    color: var(--ui-text-muted);
    background: var(--ui-bg-elevated);
}

.cmp td.base {
    color: var(--ui-text-muted);
}

pre {
    margin: 0;
    font-family: "BIZ UDGothic", "Yu Gothic UI", monospace;
    font-size: 13px;
    line-height: 1.8;
    white-space: pre-wrap;
    word-break: break-all;
}

pre :deep(u) {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    background: var(--cd-chg-app);
}

pre :deep(.none) {
    color: var(--ui-text-dimmed);
}

.sub {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.hint {
    font-size: 11px;
    color: var(--ui-text-dimmed);
}

.out-head {
    display: flex;
    align-items: center;
    margin-top: 12px;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.out {
    width: 100%;
    resize: vertical;
    padding: 8px 10px;
    border: 1px solid var(--ui-border-accented);
    border-radius: 6px;
    background: var(--cd-ed-bg);
    color: var(--cd-ed-text);
    caret-color: var(--cd-ed-cursor);
    font-family: "BIZ UDGothic", "Yu Gothic UI", monospace;
    font-size: 13px;
    line-height: 1.8;
    outline: none;
}

.out:focus {
    border-color: var(--ui-color-primary-500);
}

.deleted {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 13px;
}

.deleted p {
    margin: 0;
}

.right-body {
    flex: 1;
    overflow: auto;
}

.right-body.cd-canvas {
    padding: 20px 16px;
}

.right-body.text {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.out.full {
    flex: 1;
    resize: none;
}

.paper {
    padding: 14mm 12mm;
}

.paper :deep(.cd-active) {
    background: var(--cd-highlight);
    border-radius: 2px;
}

.status .left {
    color: var(--cd-draft);
}

.status .done {
    color: var(--ui-color-success-500);
}
</style>
