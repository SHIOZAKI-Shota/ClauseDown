<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { RepoEntry } from '@shared/api'
import { cleanSection, groupRepos } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { useStoredRef } from '~/composables/useStoredRef'
import { repoSectionItems } from '~/composables/useRepoSectionMenu'

const app = useApp()
const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'
onMounted(() => app.checkRepos())

function open(dir: string) {
    if (dir === app.repoDir) app.view = 'docs'
    else void app.switchRepo(dir)
}

const groups = computed(() => groupRepos(app.settings?.repos ?? []))
const closed = useStoredRef<string[]>('clausedown.repoSections.closed', [])
const isOpen = (g: { section: string }) => !g.section || !closed.value.includes(g.section)
const visibleRepos = (g: { section: string; repos: RepoEntry[] }) => (isOpen(g) ? g.repos : g.repos.filter((r) => r.dir === app.repoDir))
function toggle(name: string) {
    closed.value = closed.value.includes(name) ? closed.value.filter((n) => n !== name) : [...closed.value, name]
}

type Target = { kind: 'repo'; dir: string } | { kind: 'section'; name: string } | { kind: 'top' }
const menuFor = ref<Target | null>(null)
const menu = computed<DropdownMenuItem[][]>(() => {
    const t = menuFor.value
    if (t?.kind === 'repo') return [[{ label: 'セクションの移動', icon: 'i-lucide-folder-input', children: repoSectionItems(t.dir) }]]
    if (t?.kind === 'section')
        return [
            [
                { label: '名前を変える…', icon: 'i-lucide-pencil', onSelect: () => (app.dialog = { kind: 'sectionName', from: t.name }) },
                { label: 'セクションを解く', icon: 'i-lucide-folder-x', onSelect: () => void app.dissolveRepoSection(t.name) },
            ],
        ]
    return []
})

const dragging = ref<string | null>(null)
const over = ref<Target | null>(null)
const sameTarget = (a: Target | null, b: Target) =>
    !!a && a.kind === b.kind && (a.kind === 'repo' ? a.dir === (b as { dir: string }).dir : a.kind === 'section' ? a.name === (b as { name: string }).name : true)
function onDragStart(e: DragEvent, dir: string) {
    dragging.value = dir
    e.dataTransfer?.setData('text/plain', dir)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e: DragEvent, t: Target) {
    if (!dragging.value || (t.kind === 'repo' && t.dir === dragging.value)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    over.value = t
}
function onDragLeave(t: Target) {
    if (sameTarget(over.value, t)) over.value = null
}
function onDrop(t: Target) {
    const dir = dragging.value
    over.value = null
    dragging.value = null
    if (!dir) return
    if (t.kind === 'repo') {
        const target = app.settings?.repos.find((r) => r.dir === t.dir)
        void app.moveRepo(dir, { section: cleanSection(target?.section), before: t.dir })
    } else if (t.kind === 'section') void app.moveRepo(dir, { section: t.name })
    else void app.moveRepo(dir, {})
}
function onDragEnd() {
    dragging.value = null
    over.value = null
}
</script>

<template>
    <div class="repos">
        <div class="head" :class="{ drop: over?.kind === 'top' }" @dragover="(e) => onDragOver(e, { kind: 'top' })"
            @dragleave="onDragLeave({ kind: 'top' })" @drop.prevent="onDrop({ kind: 'top' })">
            <span>リポジトリ</span>
            <UButton icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" title="リポジトリの追加・管理"
                @click="app.openSettings('setup', 'repos')" />
        </div>
        <UContextMenu :items="menu" size="sm" :disabled="!menu.length">
            <div class="scroll" @contextmenu.capture="menuFor = null">
                <template v-for="g in groups" :key="g.section || '-'">
                    <button v-if="g.section" class="section"
                        :class="{ drop: over?.kind === 'section' && over.name === g.section }"
                        :aria-expanded="isOpen(g)" @click="toggle(g.section)"
                        @contextmenu="menuFor = { kind: 'section', name: g.section }"
                        @dragover="(e) => onDragOver(e, { kind: 'section', name: g.section })"
                        @dragleave="onDragLeave({ kind: 'section', name: g.section })"
                        @drop.prevent="onDrop({ kind: 'section', name: g.section })">
                        <UIcon name="i-lucide-chevron-right" class="chev" :class="{ open: isOpen(g) }" />
                        <span class="nm">{{ g.section }}</span>
                        <span class="count">{{ g.repos.length }}</span>
                    </button>
                    <template v-if="visibleRepos(g).length">
                        <button v-for="r in visibleRepos(g)" :key="r.dir" class="repo" :class="{
                            on: r.dir === app.repoDir,
                            missing: missing(r.dir),
                            inner: !!g.section,
                            drop: over?.kind === 'repo' && over.dir === r.dir,
                            lifted: dragging === r.dir,
                        }" :title="[r.name, missing(r.dir) ? '見つかりません' : r.url || r.dir].join('\n')" draggable="true"
                            @click="open(r.dir)" @contextmenu="menuFor = { kind: 'repo', dir: r.dir }"
                            @dragstart="(e) => onDragStart(e, r.dir)" @dragend="onDragEnd"
                            @dragover="(e) => onDragOver(e, { kind: 'repo', dir: r.dir })"
                            @dragleave="onDragLeave({ kind: 'repo', dir: r.dir })"
                            @drop.prevent="onDrop({ kind: 'repo', dir: r.dir })">
                            <UIcon
                                :name="missing(r.dir) ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive'" />
                            <span class="nm">{{ r.name }}</span>
                            <UBadge v-if="r.dir === app.repoDir && app.toReview.length"
                                :label="`確認待ち ${app.toReview.length}`" color="warning" variant="subtle" size="sm" />
                        </button>
                    </template>
                </template>
                <p v-if="!app.settings?.repos.length" class="empty">まだリポジトリがありません</p>
            </div>
        </UContextMenu>
    </div>
</template>

<style scoped>
.repos {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    flex: 1;
    min-height: 0;
}

.head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ui-text-muted);
    padding-left: 4px;
    border-radius: 6px;
}

.head.drop {
    background: color-mix(in oklab, var(--ui-color-primary-500) 15%, transparent);
}

.scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.section {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    margin-top: 6px;
    padding: 4px 6px 4px 4px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted);
    text-align: left;
    cursor: pointer;
}

.section:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.section.drop {
    background: color-mix(in oklab, var(--ui-color-primary-500) 15%, transparent);
    color: var(--ui-text-highlighted);
}

.chev {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    transition: transform 0.12s;
}

.chev.open {
    transform: rotate(90deg);
}

.count {
    font-weight: 400;
    font-size: 11px;
    color: var(--ui-text-dimmed);
}

.repo {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--ui-text-toned);
    text-align: left;
    cursor: pointer;
}

.repo.inner {
    padding-left: 22px;
}

.repo:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.repo.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.repo.on :deep(svg) {
    color: var(--ui-color-primary-500);
}

.repo.missing {
    color: var(--ui-text-dimmed);
}

.repo.drop {
    box-shadow: inset 0 2px 0 var(--ui-color-primary-500);
}

.repo.lifted {
    opacity: 0.5;
}

.nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    font-size: 12px;
    color: var(--ui-text-muted);
    padding: 4px;
    margin: 0;
}
</style>
