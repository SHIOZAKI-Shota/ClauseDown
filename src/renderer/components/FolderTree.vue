<script setup lang="ts">
import type { DocFile } from '@shared/api'
import type { DocActions } from '~/composables/useDocActions'
import { folderOf, type FolderNode } from '~/utils/folders'
import { useStoredRef } from '~/composables/useStoredRef'
import { useApp } from '~/stores/app'

const props = withDefaults(
    defineProps<{
        root: FolderNode
        label?: string
        actions: DocActions
        docs?: DocFile[]
        selectedDoc?: string | null
        query?: string
        hideRoot?: boolean
    }>(),
    { label: '', docs: undefined, selectedDoc: null, query: '', hideRoot: false },
)
const cwd = defineModel<string | null>({ default: null })
const app = useApp()
const { dragging, dropFolder, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } = props.actions

const closed = useStoredRef<string[]>('clausedown.folderTreeClosed', [])
const keyOf = (path: string) => `${app.repoDir}::${path}`
const words = computed(() => props.query.trim().toLowerCase().split(/\s+/).filter(Boolean))
const filtering = computed(() => words.value.length > 0)
const isOpen = (path: string) => filtering.value || !closed.value.includes(keyOf(path))
function toggle(path: string) {
    const k = keyOf(path)
    closed.value = closed.value.includes(k) ? closed.value.filter((x) => x !== k) : [...closed.value, k]
}
function openParents(folder: string) {
    const parts = folder ? folder.split('/') : []
    const keys = new Set(['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))].map(keyOf))
    if (closed.value.some((k) => keys.has(k))) closed.value = closed.value.filter((k) => !keys.has(k))
}
watch(
    () => [cwd.value, props.selectedDoc] as const,
    ([dir, doc]) => {
        if (dir !== null) openParents(dir.split('/').slice(0, -1).join('/'))
        if (doc) openParents(folderOf(doc))
    },
    { immediate: true },
)

const withDocs = computed(() => props.docs !== undefined)
const shown = computed(() => {
    const list = props.docs ?? []
    if (!filtering.value) return list
    return list.filter((d) => words.value.every((w) => `${d.title} ${d.path}`.toLowerCase().includes(w)))
})
const docsIn = computed(() => {
    const map = new Map<string, DocFile[]>()
    for (const d of shown.value) {
        const f = folderOf(d.path)
        map.set(f, [...(map.get(f) ?? []), d])
    }
    return map
})
const visible = computed(() => {
    if (!filtering.value || !withDocs.value) return null
    const set = new Set<string>([''])
    for (const d of shown.value) {
        const parts = folderOf(d.path).split('/').filter(Boolean)
        parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')))
    }
    return set
})

type Row = { kind: 'folder'; node: FolderNode; depth: number } | { kind: 'doc'; doc: DocFile; depth: number }
const rows = computed(() => {
    const out: Row[] = []
    const walk = (node: FolderNode, depth: number, self: boolean) => {
        if (visible.value && !visible.value.has(node.path)) return
        if (self) out.push({ kind: 'folder', node, depth })
        if (self && !isOpen(node.path)) return
        const inner = self ? depth + 1 : depth
        node.children.forEach((c) => walk(c, inner, true))
        if (withDocs.value) for (const doc of docsIn.value.get(node.path) ?? []) out.push({ kind: 'doc', doc, depth: inner })
    }
    walk(props.root, 0, !props.hideRoot)
    return out
})

function onFolder(path: string) {
    if (withDocs.value) toggle(path)
    else cwd.value = path
}
const isCurrent = (path: string) => !withDocs.value && cwd.value === path
const indent = (depth: number) => ({ paddingLeft: `${6 + depth * 14}px` })
</script>

<template>
    <nav class="ftree" :aria-label="withDocs ? '文書' : 'ディレクトリ'">
        <template v-for="r in rows" :key="r.kind === 'folder' ? `f:${r.node.path}` : r.doc.path">
            <div
                v-if="r.kind === 'folder'"
                class="row"
                role="button"
                tabindex="0"
                :class="{ on: isCurrent(r.node.path), drop: dropFolder === r.node.path }"
                :style="indent(r.depth)"
                :aria-current="isCurrent(r.node.path) ? 'true' : undefined"
                :aria-expanded="isOpen(r.node.path)"
                :data-folder="r.node.path"
                @click="onFolder(r.node.path)"
                @keydown.enter.self="onFolder(r.node.path)"
                @dragover="onDragOver(r.node.path, $event)"
                @dragleave="onDragLeave(r.node.path)"
                @drop="onDrop(r.node.path, $event)"
            >
                <button
                    v-if="r.node.children.length || withDocs"
                    class="chev"
                    :class="{ open: isOpen(r.node.path) }"
                    :aria-label="isOpen(r.node.path) ? 'ディレクトリを閉じる' : 'ディレクトリを開く'"
                    @click.stop="toggle(r.node.path)"
                >
                    <UIcon name="i-lucide-chevron-right" class="chev-icon" />
                </button>
                <span v-else class="chev-space" />
                <UIcon
                    :name="
                        r.node.path === ''
                            ? 'i-lucide-archive'
                            : isCurrent(r.node.path) || (withDocs && isOpen(r.node.path))
                              ? 'i-lucide-folder-open'
                              : 'i-lucide-folder'
                    "
                    class="ficon"
                />
                <span class="label">{{ r.node.path === '' ? label : r.node.name }}</span>
                <span v-if="!filtering" class="count">{{ r.node.count }}</span>
                <UButton
                    v-if="withDocs"
                    icon="i-lucide-plus"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    class="add"
                    title="このディレクトリに文書を追加"
                    @click.stop="app.dialog = { kind: 'newDoc', folder: r.node.path || undefined }"
                />
            </div>
            <button
                v-else
                class="row doc"
                :class="{ on: selectedDoc === r.doc.path, dragging: dragging?.path === r.doc.path }"
                :style="indent(r.depth)"
                draggable="true"
                :title="r.doc.path"
                :data-path="r.doc.path"
                @click="app.openDoc(r.doc.path)"
                @dragstart="onDragStart(r.doc, $event)"
                @dragend="onDragEnd"
            >
                <span class="chev-space" />
                <UIcon name="i-lucide-file-text" class="ficon" />
                <span class="label">{{ r.doc.title }}</span>
                <UIcon v-if="r.doc.changed" name="i-lucide-circle-dot" class="dot" title="版を保存していない変更があります" />
            </button>
        </template>
    </nav>
</template>

<style scoped>
.ftree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 4px 8px 4px 6px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--ui-text-toned);
    text-align: left;
    cursor: pointer;
}

.row:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.row.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.row.drop {
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
    outline: 1px dashed var(--ui-color-primary-500);
}

.row.dragging {
    opacity: 0.5;
}

.chev,
.chev-space {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
}

.chev {
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: var(--ui-text-dimmed);
    cursor: pointer;
}

.chev:hover {
    background: var(--ui-bg-elevated);
}

.chev-icon {
    width: 14px;
    height: 14px;
    transition: transform 0.15s;
}

.chev.open .chev-icon {
    transform: rotate(90deg);
}

.ficon {
    flex-shrink: 0;
    width: 15px;
    height: 15px;
    color: var(--ui-text-muted);
}

.row.on .ficon {
    color: var(--ui-color-primary-500);
}

.label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.count {
    font-size: 11px;
    color: var(--ui-text-dimmed);
    font-variant-numeric: tabular-nums;
}

.add {
    opacity: 0;
}

.row:hover .add,
.add:focus {
    opacity: 1;
}

.dot {
    flex-shrink: 0;
    color: var(--ui-color-warning-500);
    width: 12px;
    height: 12px;
}
</style>
