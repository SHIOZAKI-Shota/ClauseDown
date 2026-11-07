<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import type { DocFile, RepoActivity } from '@shared/api'
import { useApp } from '~/stores/app'
import { findFolder, folderOf, folderTree, isUnder, type FolderNode } from '~/utils/folders'
import { fmtDate, relTime, todayISO } from '~/utils/format'
import { useStoredRef } from '~/composables/useStoredRef'
import { usePane } from '~/composables/usePane'
import { useDocActions } from '~/composables/useDocActions'

type SortKey = 'name' | 'articles' | 'effective' | 'next' | 'updated'
type SortDir = 'asc' | 'desc'

const app = useApp()
const q = ref('')
const showPreview = useStoredRef('clausedown.docListPreview', true)
const sidePane = usePane('home-side', { size: 320, min: 260, max: 560 })
const treePane = usePane('home-tree', { size: 240, min: 180, max: 420 })
const viewMode = useStoredRef<'cards' | 'list' | 'table'>('clausedown.docListView', 'cards')
const sortKey = useStoredRef<SortKey>('clausedown.docListSort', 'name')
const sortDir = useStoredRef<SortDir>('clausedown.docListSortDir', 'asc')
const recursive = useStoredRef('clausedown.docListRecursive', false)
const cwds = useStoredRef<Record<string, string>>('clausedown.docListCwd', {})

const actions = useDocActions()
const { dragging, dropFolder, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } = actions

const activity = ref<RepoActivity | null>(null)
let loadSeq = 0
async function loadActivity() {
    if (!app.repoDir) return
    const seq = ++loadSeq
    const a = await window.api.repoActivity(app.repoDir).catch(() => null)
    if (seq === loadSeq) activity.value = a
}
watch(
    () => [app.repoDir, app.currentBranch?.oid, app.reloadKey, app.docs.map((d) => d.path).join('|')],
    () => void loadActivity(),
    { immediate: true },
)
onMounted(() => app.refreshDocs())

const today = todayISO()

const info = (d: DocFile) => activity.value?.docs[d.path]
const effective = computed(() => {
    const out = new Map<string, { current?: string; next?: string }>()
    for (const e of activity.value?.effective ?? []) {
        const o = out.get(e.docPath) ?? {}
        if (e.date <= today) {
            if (!o.current || e.date > o.current) o.current = e.date
        } else if (!o.next || e.date < o.next) o.next = e.date
        out.set(e.docPath, o)
    }
    return out
})
const effectiveOf = (d: DocFile) => effective.value.get(d.path) ?? {}

const tree = computed(() => folderTree(app.docs))
const cwd = computed({
    get: () => cwds.value[app.repoDir ?? ''] ?? '',
    set: (v: string) => {
        q.value = ''
        cwds.value = { ...cwds.value, [app.repoDir ?? '']: v }
    },
})
watch(tree, (t) => {
    if (cwd.value && !findFolder(t, cwd.value)) cwd.value = ''
})
const current = computed(() => findFolder(tree.value, cwd.value) ?? tree.value)
const crumbs = computed(() => {
    const parts = cwd.value ? cwd.value.split('/') : []
    return [
        { path: '', name: app.repo?.name ?? 'リポジトリ' },
        ...parts.map((name, i) => ({ path: parts.slice(0, i + 1).join('/'), name })),
    ]
})
const goUp = () => (cwd.value = cwd.value.includes('/') ? cwd.value.slice(0, cwd.value.lastIndexOf('/')) : '')

const DEFAULT_DIR: Record<SortKey, SortDir> = { name: 'asc', articles: 'desc', effective: 'desc', next: 'asc', updated: 'desc' }
const SORT_LABEL: Record<SortKey, string> = {
    name: '名前順',
    articles: '条の多い順',
    effective: '施行日が新しい順',
    next: '次の施行日が近い順',
    updated: '更新が新しい順',
}
const sortItems = computed(() =>
    (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
        value: k,
        label: k === sortKey.value && sortDir.value !== DEFAULT_DIR[k] ? `${SORT_LABEL[k]}（逆順）` : SORT_LABEL[k],
    })),
)
const sortSelect = computed({
    get: () => sortKey.value,
    set: (k: SortKey) => {
        sortKey.value = k
        sortDir.value = DEFAULT_DIR[k]
    },
})
function sortBy(k: SortKey) {
    if (sortKey.value === k) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    else sortSelect.value = k
}
const sortIcon = (k: SortKey) => (sortKey.value !== k ? '' : sortDir.value === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down')

const byName = (a: DocFile, b: DocFile) => a.title.localeCompare(b.title, 'ja', { numeric: true })
function sortValue(d: DocFile): string | number | null {
    switch (sortKey.value) {
        case 'articles':
            return info(d)?.articles ?? null
        case 'effective':
            return effectiveOf(d).current ?? null
        case 'next':
            return effectiveOf(d).next ?? null
        case 'updated':
            return info(d)?.timestamp ?? null
        default:
            return null
    }
}
function sortDocs(list: DocFile[]): DocFile[] {
    const sign = sortDir.value === 'asc' ? 1 : -1
    if (sortKey.value === 'name') return [...list].sort((a, b) => sign * byName(a, b))
    return [...list].sort((a, b) => {
        const x = sortValue(a)
        const y = sortValue(b)
        if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1
        return (x < y ? -1 : x > y ? 1 : 0) * sign || byName(a, b)
    })
}

const words = computed(() => q.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
const searching = computed(() => words.value.length > 0)
const matches = (hay: string) => words.value.every((w) => hay.toLowerCase().includes(w))

const allNodes = computed(() => {
    const out: FolderNode[] = []
    const walk = (n: FolderNode) => n.children.forEach((c) => (out.push(c), walk(c)))
    walk(tree.value)
    return out
})
const folders = computed<FolderNode[]>(() =>
    searching.value ? allNodes.value.filter((n) => matches(n.path)) : current.value.children,
)
const docs = computed(() => {
    const list = searching.value
        ? app.docs.filter((d) => matches(`${d.title} ${d.path}`))
        : app.docs.filter((d) => (recursive.value ? isUnder(d.path, cwd.value) : folderOf(d.path) === cwd.value))
    return sortDocs(list)
})
const showPath = computed(() => searching.value || recursive.value)
const relPath = (d: DocFile) => (cwd.value && !searching.value ? d.path.slice(cwd.value.length + 1) : d.path)

const target = ref<{ doc?: DocFile; folder?: string } | null>(null)
function onContextMenu(e: MouseEvent) {
    const el = e.target as HTMLElement
    const path = el.closest<HTMLElement>('[data-path]')?.dataset.path
    const folder = el.closest<HTMLElement>('[data-folder]')?.dataset.folder
    const doc = path ? app.docs.find((d) => d.path === path) : undefined
    target.value = doc ? { doc } : folder !== undefined ? { folder } : null
}
const newDocIn = (folder: string) => (app.dialog = { kind: 'newDoc', folder: folder || undefined })
const menu = computed<ContextMenuItem[][]>(() => {
    const t = target.value
    if (t?.doc) {
        const d = t.doc
        return actions.docMenu(d, [
            { label: '改定履歴', icon: 'i-lucide-git-commit-horizontal', onSelect: () => app.openDoc(d.path, 'history') },
            { label: '期日・納品', icon: 'i-lucide-package', onSelect: () => app.openDoc(d.path, 'releases') },
        ])
    }
    if (t?.folder !== undefined) {
        const f = t.folder
        return [
            [
                { label: '開く', icon: 'i-lucide-folder-open', onSelect: () => (cwd.value = f) },
                { label: 'この中に新しい文書', icon: 'i-lucide-file-plus', onSelect: () => newDocIn(f) },
            ],
        ]
    }
    return [[{ label: cwd.value ? `「${cwd.value}」に新しい文書` : '新しい文書', icon: 'i-lucide-file-plus', onSelect: () => newDocIn(cwd.value) }]]
})

const VIEWS = [
    { value: 'cards' as const, icon: 'i-lucide-layout-grid', tooltip: 'カード' },
    { value: 'list' as const, icon: 'i-lucide-list', tooltip: '一覧' },
    { value: 'table' as const, icon: 'i-lucide-table-2', tooltip: '詳細' },
]
</script>

<template>
    <div class="home">
        <header class="head">
            <div class="title">
                <h2>{{ app.repo?.name }}</h2>
                <HomeSummary />
            </div>
            <span class="cd-grow" />
            <UButton :label="cwd ? `「${current.name}」に新しい文書` : '新しい文書'" icon="i-lucide-plus" @click="newDocIn(cwd)" />
        </header>

        <div class="body">
            <SidePane :pane="treePane" side="left" label="ディレクトリ" icon="i-lucide-folder-tree">
                <div class="tree-body">
                    <FolderTree v-model="cwd" :root="tree" :label="app.repo?.name ?? 'リポジトリ'" :actions="actions" />
                </div>
            </SidePane>

            <div class="docs-pane">
                <div class="docs-head">
                    <UButton icon="i-lucide-arrow-up" size="sm" color="neutral" variant="ghost" square aria-label="上のディレクトリへ"
                        :disabled="!cwd || searching" @click="goUp" />
                    <nav class="crumbs" aria-label="今いるディレクトリ">
                        <template v-for="(c, i) in crumbs" :key="c.path">
                            <UIcon v-if="i > 0" name="i-lucide-chevron-right" class="sep" />
                            <button class="crumb" :class="{ on: c.path === cwd && !searching, drop: dropFolder === c.path }"
                                :data-folder="c.path" @click="cwd = c.path" @dragover="onDragOver(c.path, $event)"
                                @dragleave="onDragLeave(c.path)" @drop="onDrop(c.path, $event)">
                                <UIcon v-if="i === 0" name="i-lucide-archive" />{{ c.name }}
                            </button>
                        </template>
                    </nav>
                    <span class="cd-grow" />
                    <UInput v-model="q" icon="i-lucide-search" placeholder="リポジトリ全体から探す" size="sm" class="search" />
                </div>
                <div class="docs-tools">
                    <span class="muted">
                        <template v-if="searching">「{{ q.trim() }}」の検索結果：</template>
                        <template v-if="folders.length">ディレクトリ {{ folders.length }}・</template>文書 {{ docs.length }}
                    </span>
                    <USwitch v-if="!searching" v-model="recursive" size="sm" label="サブディレクトリの文書も表示" class="rec" />
                    <span class="cd-grow" />
                    <USelect v-if="viewMode !== 'table'" v-model="sortSelect" size="sm" class="sort" :items="sortItems" />
                    <SegmentSwitch v-model="viewMode" aria-label="表示のしかた" :items="VIEWS" />
                    <UTooltip v-if="viewMode === 'cards'" :text="showPreview ? 'カードのプレビューを消す' : 'カードにプレビューを出す'">
                        <UButton icon="i-lucide-image" square size="sm" :color="showPreview ? 'primary' : 'neutral'"
                            :variant="showPreview ? 'soft' : 'outline'" aria-label="カードにプレビュー"
                            @click="showPreview = !showPreview" />
                    </UTooltip>
                </div>

                <UContextMenu :items="menu" size="sm">
                    <div class="docs-scroll" @contextmenu="onContextMenu">
                        <p v-if="app.docs.length === 0" class="muted empty">まだ文書がありません。「新しい文書」から作成してください。</p>
                        <p v-else-if="!folders.length && !docs.length" class="muted empty">
                            {{ searching ? '見つかりません。' : 'このディレクトリには文書がありません。' }}
                        </p>

                        <table v-if="viewMode === 'table' && (folders.length || docs.length)" class="table">
                            <thead>
                                <tr>
                                    <th><button class="th" @click="sortBy('name')">名前<UIcon v-if="sortIcon('name')" :name="sortIcon('name')" /></button></th>
                                    <th class="num"><button class="th" @click="sortBy('articles')">条<UIcon v-if="sortIcon('articles')" :name="sortIcon('articles')" /></button></th>
                                    <th><button class="th" @click="sortBy('effective')">施行中<UIcon v-if="sortIcon('effective')" :name="sortIcon('effective')" /></button></th>
                                    <th><button class="th" @click="sortBy('next')">次の施行<UIcon v-if="sortIcon('next')" :name="sortIcon('next')" /></button></th>
                                    <th><button class="th" @click="sortBy('updated')">最終更新<UIcon v-if="sortIcon('updated')" :name="sortIcon('updated')" /></button></th>
                                    <th>状態</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="f in folders" :key="`f:${f.path}`" class="frow" :class="{ drop: dropFolder === f.path }"
                                    :data-folder="f.path" @click="cwd = f.path" @dragover="onDragOver(f.path, $event)"
                                    @dragleave="onDragLeave(f.path)" @drop="onDrop(f.path, $event)">
                                    <td colspan="6">
                                        <div class="name">
                                            <UIcon name="i-lucide-folder" class="ficon folder" />
                                            <span class="t">{{ searching ? f.path : f.name }}</span>
                                            <span class="muted">{{ f.count }} 文書</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr v-for="d in docs" :key="d.path" :data-path="d.path" draggable="true"
                                    :class="{ dragging: dragging?.path === d.path }" @click="app.openDoc(d.path)"
                                    @dragstart="onDragStart(d, $event)" @dragend="onDragEnd">
                                    <td>
                                        <div class="name">
                                            <UIcon name="i-lucide-file-text" class="ficon" />
                                            <div class="min">
                                                <div class="t">{{ d.title }}</div>
                                                <div class="cd-muted path">{{ showPath ? relPath(d) : d.path.split('/').pop() }}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="num">{{ info(d)?.articles ?? '' }}</td>
                                    <td>{{ effectiveOf(d).current ? fmtDate(effectiveOf(d).current!, 'ymd') : '—' }}</td>
                                    <td :class="{ next: effectiveOf(d).next }">
                                        {{ effectiveOf(d).next ? fmtDate(effectiveOf(d).next!, 'ymd') : '—' }}</td>
                                    <td>
                                        <span v-if="info(d)?.timestamp" :title="fmtDate(info(d)!.timestamp!, 'ymdhm')">
                                            {{ info(d)!.author }}・{{ relTime(info(d)!.timestamp!) }}
                                        </span>
                                        <span v-else class="cd-muted">まだ版なし</span>
                                    </td>
                                    <td>
                                        <UBadge v-if="d.changed" label="未保存の変更" color="warning" variant="subtle" size="sm" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>

                        <template v-else>
                            <div v-if="folders.length" class="ftiles">
                                <button v-for="f in folders" :key="f.path" class="ftile" :class="{ drop: dropFolder === f.path }"
                                    :data-folder="f.path" @click="cwd = f.path" @dragover="onDragOver(f.path, $event)"
                                    @dragleave="onDragLeave(f.path)" @drop="onDrop(f.path, $event)">
                                    <UIcon name="i-lucide-folder" class="ficon folder" />
                                    <span class="min">
                                        <span class="t">{{ searching ? f.path : f.name }}</span>
                                        <span class="muted">{{ f.count }} 文書<template v-if="f.children.length">・ディレクトリ {{ f.children.length }}</template></span>
                                    </span>
                                </button>
                            </div>

                            <div v-if="viewMode === 'list' && docs.length" class="list">
                                <button v-for="d in docs" :key="d.path" class="item" :class="{ dragging: dragging?.path === d.path }"
                                    :data-path="d.path" draggable="true" @click="app.openDoc(d.path)"
                                    @dragstart="onDragStart(d, $event)" @dragend="onDragEnd">
                                    <UIcon name="i-lucide-file-text" class="ficon" />
                                    <span class="min">
                                        <span class="t">{{ d.title }}</span>
                                        <span class="cd-muted path">{{ showPath ? relPath(d) : d.path.split('/').pop() }}</span>
                                    </span>
                                    <UIcon v-if="d.changed" name="i-lucide-circle-dot" class="dot" title="版を保存していない変更があります" />
                                </button>
                            </div>

                            <div v-else-if="docs.length" class="grid">
                                <UCard v-for="d in docs" :key="d.path" class="doc"
                                    :class="{ 'has-preview': showPreview, dragging: dragging?.path === d.path }"
                                    :ui="{ body: 'p-0 sm:p-0' }" :data-path="d.path" draggable="true" @click="app.openDoc(d.path)"
                                    @dragstart="onDragStart(d, $event)" @dragend="onDragEnd">
                                    <div v-if="showPreview" class="preview">
                                        <DocThumb :path="d.path" />
                                        <UBadge v-if="d.changed" label="未保存の変更" color="warning" variant="solid" size="sm" class="flag" />
                                    </div>
                                    <div class="info">
                                        <div class="t">{{ d.title }}</div>
                                        <div class="cd-muted path">{{ showPath ? relPath(d) : d.path.split('/').pop() }}</div>
                                        <div class="stats">
                                            <span v-if="info(d)">
                                                <UIcon name="i-lucide-list-ordered" />{{ info(d)!.articles }} 条
                                            </span>
                                            <span v-if="effectiveOf(d).current" :title="`施行中の版：${effectiveOf(d).current} 施行`">
                                                <UIcon name="i-lucide-badge-check" />{{ fmtDate(effectiveOf(d).current!, 'ymd') }} 施行
                                            </span>
                                            <span v-if="effectiveOf(d).next" class="next" :title="`次の施行日：${effectiveOf(d).next}`">
                                                <UIcon name="i-lucide-calendar-clock" />{{ fmtDate(effectiveOf(d).next!, 'ymd') }} 予定
                                            </span>
                                        </div>
                                        <div class="foot">
                                            <UBadge v-if="d.changed && !showPreview" label="未保存の変更" color="warning" variant="subtle" size="sm" />
                                            <span v-else-if="info(d)?.timestamp" class="cd-muted updated"
                                                :title="fmtDate(info(d)!.timestamp!, 'ymdhm')">{{ info(d)!.author }}・{{ relTime(info(d)!.timestamp!) }}</span>
                                            <span class="cd-grow" />
                                            <UButton label="改定履歴" size="xs" color="neutral" variant="ghost"
                                                @click.stop="app.openDoc(d.path, 'history')" />
                                            <UButton label="期日・納品" size="xs" color="neutral" variant="ghost"
                                                @click.stop="app.openDoc(d.path, 'releases')" />
                                        </div>
                                    </div>
                                </UCard>
                            </div>
                        </template>
                    </div>
                </UContextMenu>
            </div>

            <SidePane :pane="sidePane" side="right" label="メモ・改定案・期日" icon="i-lucide-notebook-text">
                <div class="side-body">
                    <HomeNote />
                    <HomeDrafts />
                    <HomeSchedule />
                    <HomeRecent :activity="activity" />
                </div>
            </SidePane>
        </div>

        <DocActionModals :actions="actions" />
    </div>
</template>

<style scoped>
.home {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 10px 16px;
    border-bottom: 1px solid var(--ui-border);
}

.title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
}

h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    line-height: 1.2;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.body {
    flex: 1;
    min-height: 0;
    display: flex;
}

.tree-body {
    padding: 4px 8px 16px;
}

.docs-pane {
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.docs-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 8px 16px 4px 10px;
}

.crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow: hidden;
}

.crumb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px;
    border-radius: 6px;
    font-size: 14px;
    color: var(--ui-text-toned);
    white-space: nowrap;
    cursor: pointer;
}

.crumb:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.crumb.on {
    color: var(--ui-text-highlighted);
    font-weight: 700;
}

.crumb.drop,
.ftile.drop,
.frow.drop {
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
    outline: 1px dashed var(--ui-color-primary-500);
}

.sep {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--ui-text-dimmed);
}

.search {
    width: 240px;
    flex-shrink: 0;
}

.docs-tools {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    flex-shrink: 0;
    padding: 4px 16px 10px;
    border-bottom: 1px solid var(--ui-border);
}

.rec {
    font-size: 12px;
}

.sort {
    width: 190px;
}

.docs-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 24px;
}

.side-body {
    padding: 0 16px 20px;
}

.muted {
    color: var(--ui-text-muted);
    font-size: 12px;
}

.empty {
    font-size: 13px;
}

.ficon {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    color: var(--ui-text-muted);
}

.ficon.folder {
    color: var(--ui-color-warning-500);
}

.min {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.min .t,
.min .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ftiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    margin-bottom: 20px;
}

.ftile,
.item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-bg);
    text-align: left;
    cursor: pointer;
}

.ftile:hover,
.item:hover {
    border-color: var(--ui-primary);
    background: var(--ui-bg-elevated);
}

.ftile .t,
.item .t {
    font-size: 14px;
    font-weight: 600;
}

.list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
}

.item .min {
    flex: 1;
}

.item .path {
    font-size: 11px;
}

.dot {
    flex-shrink: 0;
    color: var(--ui-color-warning-500);
    width: 12px;
    height: 12px;
}

.dragging {
    opacity: 0.5;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
    padding: 2px;
}

.doc {
    cursor: pointer;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.15s;
}

.doc:hover {
    outline: 1px solid var(--ui-primary);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.08);
}

.preview {
    position: relative;
    height: 240px;
    border-bottom: 1px solid var(--ui-border);
}

.preview :deep(.sheet) {
    transition: transform 0.2s;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
}

.doc:hover .preview :deep(.sheet) {
    transform: translateY(-3px);
}

.flag {
    position: absolute;
    top: 10px;
    right: 10px;
}

.info {
    padding: 14px 16px 12px;
}

.t {
    font-size: 16px;
    font-weight: 700;
}

.path {
    font-size: 12px;
}

.stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--ui-text-toned);
}

.stats span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.next {
    color: var(--ui-color-primary-500);
}

.foot {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
}

.updated {
    font-size: 12px;
}

.table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.table th {
    text-align: left;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted);
    padding: 0 10px 6px;
    border-bottom: 1px solid var(--ui-border-accented);
}

.th {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 600;
    cursor: pointer;
}

.th:hover {
    color: var(--ui-text-highlighted);
}

.table td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--ui-border);
    vertical-align: middle;
}

.table tbody tr {
    cursor: pointer;
}

.table tbody tr:hover {
    background: var(--ui-bg-elevated);
}

.table .name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.table .t {
    font-size: 14px;
    font-weight: 600;
}

.frow .muted {
    margin-left: 8px;
}

.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    width: 48px;
}

.table th.num .th {
    justify-content: flex-end;
}
</style>
