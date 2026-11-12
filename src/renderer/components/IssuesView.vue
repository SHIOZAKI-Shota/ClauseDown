<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import type { CommitInfo, Issue, IssueDetail } from '@shared/api'
import { useApp } from '~/stores/app'
import { fmtDate } from '~/utils/format'
import { MOD_KEY } from '~/utils/platform'

const app = useApp()
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener')
    return self.renderToken(tokens, idx, options)
}
const dir = app.repoDir!

const list = ref<Issue[]>([])
const loading = ref(true)
const error = ref('')
const filter = ref<'open' | 'closed'>('open')
const q = ref('')
const selected = ref<number | null>(null)
const detail = ref<IssueDetail | null>(null)
const pending = ref(0)

const creating = ref(false)
const newTitle = ref('')
const newBody = ref('')
const editing = ref(false)
const editTitle = ref('')
const editBody = ref('')

const versions = ref<CommitInfo[]>([])
const picker = ref<'link' | 'close' | null>(null)
const NO_VERSION = 'none'
const pickOid = ref<string>('')

const sourceLabel = computed(() => (app.forge === 'github' ? 'GitHub' : app.forge === 'gitlab' ? 'GitLab' : ''))
const counts = computed(() => ({ open: list.value.filter((i) => i.state === 'open').length, closed: list.value.filter((i) => i.state === 'closed').length }))
const shown = computed(() => {
    const w = q.value.trim().toLowerCase()
    return list.value.filter((i) => i.state === filter.value && (!w || `#${i.n} ${i.title} ${i.body}`.toLowerCase().includes(w)))
})

async function load() {
    loading.value = true
    error.value = ''
    try {
        list.value = await window.api.listIssues(dir)
        app.openIssueCount = list.value.filter((i) => i.state === 'open').length
        pending.value = await window.api.pendingLocalIssues(dir).catch(() => 0)
    } catch (e) {
        error.value = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
        loading.value = false
    }
}

async function open(n: number) {
    if (selected.value !== n) draft.value = ''
    selected.value = n
    creating.value = false
    editing.value = false
    detail.value = (await app.run(() => window.api.issueDetail(dir, n))) ?? null
}

const draft = ref('')
const posting = ref(false)
const reloading = ref(false)
async function postComment() {
    const n = detail.value?.n
    if (!n || !draft.value.trim() || posting.value) return
    posting.value = true
    const ok = await app.runOk(() => window.api.commentIssue(dir, n, draft.value), 'コメントしました')
    posting.value = false
    if (!ok) return
    draft.value = ''
    await open(n)
}
async function reloadDetail() {
    const n = detail.value?.n
    if (!n) return
    reloading.value = true
    await Promise.all([load(), open(n)])
    reloading.value = false
}
function onDraftKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault()
        void postComment()
    }
}
const EVENT = { link: 'を紐付けました', close: 'で解決しました' } as const

function startNew(draft?: { title: string; body: string }) {
    creating.value = true
    selected.value = null
    detail.value = null
    newTitle.value = draft?.title ?? ''
    newBody.value = draft?.body ?? ''
}

async function create() {
    const made = await app.run(() => window.api.createIssue(dir, { title: newTitle.value, body: newBody.value }), '課題を作りました')
    if (!made) return
    await load()
    filter.value = 'open'
    await open(made.n)
}

function startEdit() {
    if (!detail.value) return
    editTitle.value = detail.value.title
    editBody.value = detail.value.body
    editing.value = true
}

async function saveEdit() {
    if (!detail.value) return
    const ok = await app.run(() => window.api.updateIssue(dir, detail.value!.n, { title: editTitle.value, body: editBody.value }))
    if (!ok) return
    editing.value = false
    await Promise.all([load(), open(detail.value.n)])
}

async function openPicker(kind: 'link' | 'close') {
    versions.value = ((await app.run(() => window.api.log(dir, undefined, true))) ?? []).slice(0, 80)
    pickOid.value = kind === 'link' ? (versions.value[0]?.oid ?? '') : NO_VERSION
    picker.value = kind
}

async function confirmPicker() {
    const n = detail.value?.n
    if (!n) return
    const kind = picker.value
    picker.value = null
    if (kind === 'link' && pickOid.value) await app.run(() => window.api.linkIssue(dir, n, pickOid.value), '版を紐付けました')
    if (kind === 'close')
        await app.run(() => window.api.closeIssue(dir, n, pickOid.value === NO_VERSION ? undefined : pickOid.value || undefined), `#${n} を閉じました`)
    await Promise.all([load(), open(n)])
}

async function reopen() {
    const n = detail.value?.n
    if (!n) return
    await app.run(() => window.api.updateIssue(dir, n, { state: 'open' }), `#${n} を開き直しました`)
    await Promise.all([load(), open(n)])
}

async function moveToForge() {
    const r = await app.run(() => window.api.moveIssuesToForge(dir))
    if (!r) return
    const shifted = r.renumbered.length ? `。番号が変わった課題：${r.renumbered.map((x) => `#${x.from}→#${x.to}`).join('、')}` : ''
    app.notify(`${r.moved} 件の課題を ${sourceLabel.value} に移しました${shifted}`)
    await load()
}

const versionItems = computed(() => [
    ...(picker.value === 'close' ? [{ label: '版を指定しない', value: NO_VERSION }] : []),
    ...versions.value.map((c) => ({ label: `${c.oid.slice(0, 7)}　${c.message.split('\n')[0]}`, value: c.oid })),
])
const HOW = { close: '解決', link: '紐付け', ref: '言及' } as const
const short = (oid: string) => oid.slice(0, 7)
const dateOf = (s?: string) => (s ? fmtDate(s, 'ymd') : '')
const openOnSite = (url: string) => app.run(() => window.api.openExternal(url))

function openVersion(oid: string) {
    if (!app.currentDoc) return
    app.historySelect = oid
    app.view = 'history'
}

onMounted(async () => {
    await load()
    const t = app.issueTarget
    app.issueTarget = null
    if (t?.draft) startNew(t.draft)
    else if (t?.n) {
        const hit = list.value.find((i) => i.n === t.n)
        if (hit) filter.value = hit.state
        await open(t.n)
    }
})
</script>

<template>
    <div class="issues">
        <UButton
            :label="app.pageReturnLabel('issues')"
            icon="i-lucide-arrow-left"
            size="sm"
            color="neutral"
            variant="ghost"
            class="back"
            @click="app.leavePage('issues')"
        />
        <header class="head">
            <div class="title">
                <h2>課題</h2>
                <p class="cd-muted">
                    {{ app.repo?.name }}<template v-if="sourceLabel">（{{ sourceLabel }} の Issue）</template>
                    <template v-else>（このリポジトリの記録に保存）</template>
                </p>
            </div>
            <span class="cd-grow" />
            <UButton label="新しい課題" icon="i-lucide-plus" @click="startNew()" />
        </header>

        <UAlert
            v-if="pending"
            class="banner"
            color="warning"
            variant="subtle"
            icon="i-lucide-arrow-right-left"
            :title="`このリポジトリには、${sourceLabel} に接続する前に作った課題が ${pending} 件あります`"
            :description="`${sourceLabel} に移すと、以後は ${sourceLabel} の Issue として扱います。新しく作ったリポジトリなら番号もそのまま引き継がれます。`"
            :actions="[{ label: `${sourceLabel} に移す`, onClick: moveToForge }]"
        />

        <div class="body">
            <aside class="list">
                <div class="tools">
                    <SegmentSwitch
                        v-model="filter"
                        size="xs"
                        :items="[
                            { value: 'open', label: `未完了 ${counts.open}` },
                            { value: 'closed', label: `完了 ${counts.closed}` },
                        ]"
                    />
                    <UInput v-model="q" icon="i-lucide-search" placeholder="番号・題名・本文で探す" size="sm" class="w-full" />
                </div>
                <p v-if="loading" class="cd-muted pad">読み込んでいます…</p>
                <p v-else-if="error" class="err pad">{{ error }}</p>
                <p v-else-if="!shown.length" class="cd-muted pad">{{ filter === 'open' ? '未完了の課題はありません。' : '完了した課題はありません。' }}</p>
                <button v-for="i in shown" :key="i.n" class="row" :class="{ on: selected === i.n }" @click="open(i.n)">
                    <UIcon :name="i.state === 'open' ? 'i-lucide-circle-dot' : 'i-lucide-circle-check'" :class="['st', i.state]" />
                    <span class="num">#{{ i.n }}</span>
                    <span class="ttl">{{ i.title }}</span>
                    <span class="meta">{{ i.author }} {{ dateOf(i.createdAt) }}</span>
                </button>
            </aside>

            <section class="detail">
                <div v-if="creating" class="cd-form">
                    <h3>新しい課題</h3>
                    <UFormField label="題名">
                        <UInput v-model="newTitle" class="w-full" autofocus placeholder="例：第12条の休日の定義を見直す" />
                    </UFormField>
                    <UFormField label="本文" description="Markdown で書けます。">
                        <UTextarea v-model="newBody" :rows="10" class="w-full" />
                    </UFormField>
                    <div class="cd-modal-foot">
                        <UButton label="やめる" color="neutral" variant="outline" @click="creating = false" />
                        <UButton label="作る" icon="i-lucide-plus" :disabled="!newTitle.trim()" @click="create" />
                    </div>
                </div>

                <template v-else-if="detail">
                    <div class="d-head">
                        <UBadge
                            :label="detail.state === 'open' ? '未完了' : '完了'"
                            :color="detail.state === 'open' ? 'success' : 'neutral'"
                            variant="subtle"
                            :icon="detail.state === 'open' ? 'i-lucide-circle-dot' : 'i-lucide-circle-check'"
                        />
                        <h3 v-if="!editing">#{{ detail.n }} {{ detail.title }}</h3>
                        <UInput v-else v-model="editTitle" class="grow" />
                        <span class="cd-grow" />
                        <UTooltip text="サイトで書かれたコメントなどを読み直します">
                            <UButton
                                icon="i-lucide-refresh-cw"
                                size="sm"
                                color="neutral"
                                variant="ghost"
                                aria-label="再読み込み"
                                :loading="reloading"
                                @click="reloadDetail"
                            />
                        </UTooltip>
                        <UButton
                            v-if="detail.url"
                            :label="`${sourceLabel} で開く`"
                            icon="i-lucide-external-link"
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            @click="openOnSite(detail.url)"
                        />
                    </div>
                    <p class="cd-muted sub">
                        {{ detail.author }} が {{ dateOf(detail.createdAt) }} に作成
                        <template v-if="detail.state === 'closed' && detail.closedAt">・{{ dateOf(detail.closedAt) }} に完了</template>
                    </p>

                    <div class="actions">
                        <template v-if="!editing">
                            <UButton label="版を紐付ける" icon="i-lucide-link" size="sm" color="neutral" variant="outline" @click="openPicker('link')" />
                            <UButton v-if="detail.state === 'open'" label="閉じる" icon="i-lucide-circle-check" size="sm" @click="openPicker('close')" />
                            <UButton v-else label="開き直す" icon="i-lucide-rotate-ccw" size="sm" color="neutral" variant="outline" @click="reopen" />
                            <UButton label="編集" icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" @click="startEdit" />
                        </template>
                        <template v-else>
                            <UButton label="やめる" size="sm" color="neutral" variant="outline" @click="editing = false" />
                            <UButton label="保存" size="sm" :disabled="!editTitle.trim()" @click="saveEdit" />
                        </template>
                    </div>

                    <UTextarea v-if="editing" v-model="editBody" :rows="10" class="w-full" />
                    <div v-else-if="detail.body.trim()" class="md" v-html="md.render(detail.body)" />
                    <p v-else class="cd-muted">本文はありません。</p>

                    <h4>紐付いた版</h4>
                    <p v-if="!detail.versions.length" class="cd-muted">
                        まだありません。版を保存するときにこの課題を選ぶか、メッセージに #{{ detail.n }} と書くと、ここに並びます。
                    </p>
                    <ul v-else class="vers">
                        <li v-for="v in detail.versions" :key="v.oid">
                            <UBadge :label="HOW[v.how]" size="sm" :color="v.how === 'close' ? 'success' : 'neutral'" variant="subtle" />
                            <UTooltip :text="app.currentDoc ? '改定履歴で開く' : '文書を開いていると、改定履歴で見られます'">
                                <button class="oid" :disabled="!app.currentDoc" @click="openVersion(v.oid)">{{ short(v.oid) }}</button>
                            </UTooltip>
                            <span class="vmsg">{{ v.message.split('\n')[0] }}</span>
                            <span class="cd-muted">{{ v.at ? fmtDate(v.at, 'ymd') : '' }}</span>
                        </li>
                    </ul>
                    <template v-if="detail.drafts.length">
                        <h4>紐付いた改定案（現行版に反映すると閉じます）</h4>
                        <ul class="vers">
                            <li v-for="b in detail.drafts" :key="b"><UIcon name="i-lucide-git-branch" />{{ b.replace(/^案\//, '') }}</li>
                        </ul>
                    </template>

                    <h4>
                        コメント<span v-if="detail.comments.some((c) => c.kind === 'user')" class="cd-muted count">{{
                            detail.comments.filter((c) => c.kind === 'user').length
                        }}</span>
                    </h4>
                    <ol class="thread">
                        <template v-for="c in detail.comments" :key="c.id">
                            <li v-if="c.kind === 'user'" class="comment">
                                <div class="c-head">
                                    <UIcon name="i-lucide-message-square" />
                                    <strong>{{ c.by ?? '（不明）' }}</strong>
                                    <span class="cd-muted">{{ fmtDate(c.at, 'ymdhm') }}</span>
                                </div>
                                <div class="md c-body" v-html="md.render(c.body)" />
                            </li>
                            <li v-else class="event cd-muted">
                                <UIcon :name="c.kind === 'close' ? 'i-lucide-circle-check' : 'i-lucide-link'" />
                                <span>{{ c.by ?? '' }} が版</span>
                                <UTooltip :text="app.currentDoc ? '改定履歴で開く' : '文書を開いていると、改定履歴で見られます'">
                                    <button class="oid" :disabled="!app.currentDoc" @click="openVersion(c.oid!)">{{ short(c.oid!) }}</button>
                                </UTooltip>
                                <span>{{ EVENT[c.kind] }}</span>
                                <span class="at">{{ fmtDate(c.at, 'ymdhm') }}</span>
                            </li>
                        </template>
                    </ol>
                    <div class="composer">
                        <UTextarea
                            v-model="draft"
                            :rows="3"
                            autoresize
                            :maxrows="12"
                            class="w-full"
                            placeholder="コメントを書く（Markdown が使えます）"
                            @keydown="onDraftKey"
                        />
                        <div class="c-foot">
                            <span class="cd-muted hint">{{ MOD_KEY }}＋Enter で送信</span>
                            <UButton label="コメントする" icon="i-lucide-send" size="sm" :loading="posting" :disabled="!draft.trim()" @click="postComment" />
                        </div>
                    </div>
                </template>

                <div v-else class="empty cd-muted">
                    <UIcon name="i-lucide-list-todo" class="big" />
                    <p>課題を選ぶか、「新しい課題」から作ってください。</p>
                </div>
            </section>
        </div>

        <UModal
            :open="!!picker"
            :title="picker === 'close' ? `#${detail?.n} を閉じる` : `#${detail?.n} に版を紐付ける`"
            :description="picker === 'close' ? '解決した版を選ぶと、課題に記録します（選ばなくても閉じられます）。' : '紐付ける版を選びます。'"
            @update:open="(v) => !v && (picker = null)"
        >
            <template #body>
                <USelect v-model="pickOid" :items="versionItems" class="w-full" />
            </template>
            <template #footer>
                <div class="cd-modal-foot">
                    <UButton label="やめる" color="neutral" variant="outline" @click="picker = null" />
                    <UButton :label="picker === 'close' ? '閉じる' : '紐付ける'" :disabled="picker === 'link' && !pickOid" @click="confirmPicker" />
                </div>
            </template>
        </UModal>
    </div>
</template>

<style scoped>
.issues {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.back {
    align-self: flex-start;
    margin: 10px 0 -8px 14px;
}

.head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 24px 12px;
}

.head h2 {
    margin: 0;
    font-size: 20px;
}

.head p {
    margin: 2px 0 0;
    font-size: 12px;
}

.banner {
    margin: 0 24px 12px;
}

.body {
    display: grid;
    grid-template-columns: minmax(280px, 380px) 1fr;
    flex: 1;
    min-height: 0;
    border-top: 1px solid var(--ui-border);
}

.list {
    overflow-y: auto;
    border-right: 1px solid var(--ui-border);
}

.tools {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    position: sticky;
    top: 0;
    background: var(--ui-bg);
    z-index: 1;
}

.pad {
    padding: 12px 16px;
}

.err {
    color: var(--ui-error);
}

.row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    width: 100%;
    padding: 8px 14px;
    text-align: left;
    border-bottom: 1px solid var(--ui-border);
    cursor: pointer;
}

.row:hover {
    background: var(--ui-bg-elevated);
}

.row.on {
    background: var(--cd-selected);
}

.st {
    grid-row: span 2;
    margin-top: 3px;
}

.st.open {
    color: var(--ui-success);
}

.st.closed {
    color: var(--ui-text-muted);
}

.num {
    color: var(--ui-text-muted);
    font-variant-numeric: tabular-nums;
}

.ttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.meta {
    grid-column: 2 / 4;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.detail {
    overflow-y: auto;
    padding: 20px 28px;
}

.d-head {
    display: flex;
    align-items: center;
    gap: 10px;
}

.d-head h3 {
    margin: 0;
    font-size: 18px;
}

.grow {
    flex: 1;
}

.sub {
    margin: 4px 0 12px;
    font-size: 12px;
}

.actions {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote) {
    margin: 0 0 0.6em;
}

.md :deep(> :last-child) {
    margin-bottom: 0;
}

.md :deep(ul) {
    list-style: disc;
    padding-left: 1.5em;
}

.md :deep(ol) {
    list-style: decimal;
    padding-left: 1.5em;
}

.md :deep(a) {
    color: var(--ui-primary);
    text-decoration: underline;
}

.md :deep(code) {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
    padding: 0 0.3em;
    border-radius: 4px;
    background: var(--ui-bg-elevated);
}

.md :deep(pre) {
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--ui-bg-elevated);
    overflow-x: auto;
}

.md :deep(pre code) {
    padding: 0;
    background: none;
}

.md :deep(blockquote) {
    padding-left: 12px;
    border-left: 3px solid var(--ui-border);
    color: var(--ui-text-muted);
}

h4 {
    margin: 24px 0 8px;
    font-size: 13px;
}

.count {
    margin-left: 6px;
    font-weight: normal;
}

.thread {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.comment {
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    overflow: hidden;
}

.c-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    background: var(--ui-bg-elevated);
    border-bottom: 1px solid var(--ui-border);
}

.c-body {
    padding: 8px 12px;
}

.event {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
}

.event .at {
    margin-left: auto;
}

.composer {
    margin-top: 12px;
}

.c-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 6px;
}

.hint {
    font-size: 12px;
}

.vers {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.vers li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}

.oid {
    font-family: ui-monospace, monospace;
    color: var(--ui-primary);
    cursor: pointer;
}

.oid:disabled {
    color: var(--ui-text-muted);
    cursor: default;
}

.vmsg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
}

.big {
    font-size: 40px;
}
</style>
