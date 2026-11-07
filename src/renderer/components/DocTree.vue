<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import { useApp } from '~/stores/app'
import { folderTree } from '~/utils/folders'
import { useDocActions } from '~/composables/useDocActions'
import type { Pane } from '~/composables/usePane'

defineProps<{ pane?: Pane }>()
const app = useApp()
const q = ref('')

const tree = computed(() => folderTree(app.docs))
const selected = computed(() => (['home', 'docs', 'setup', 'about', 'repo'].includes(app.view) ? null : app.currentPath))

const words = computed(() => q.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
const hits = computed(() => app.docs.filter((d) => words.value.every((w) => `${d.title} ${d.path}`.toLowerCase().includes(w))))

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') q.value = ''
    if (e.key === 'Enter' && words.value.length && hits.value[0]) app.openDoc(hits.value[0].path)
}

const actions = useDocActions()
const { dragging, dropFolder, onDragOver, onDragLeave, onDrop } = actions
const target = ref<{ doc?: string; folder?: string } | null>(null)
function onContextMenu(e: MouseEvent) {
    const el = e.target as HTMLElement
    const doc = el.closest<HTMLElement>('[data-path]')?.dataset.path
    const folder = el.closest<HTMLElement>('[data-folder]')?.dataset.folder
    target.value = doc ? { doc } : folder !== undefined ? { folder } : null
}
const newDocIn = (folder?: string) => (app.dialog = { kind: 'newDoc', folder: folder || undefined })
const menu = computed<ContextMenuItem[][]>(() => {
    const doc = target.value?.doc ? app.docs.find((d) => d.path === target.value!.doc) : undefined
    if (doc) return actions.docMenu(doc)
    const folder = target.value?.folder
    if (folder) return [[{ label: 'この中に新しい文書', icon: 'i-lucide-file-plus', onSelect: () => newDocIn(folder) }]]
    return [[{ label: '新しい文書', icon: 'i-lucide-file-plus', onSelect: () => newDocIn() }]]
})
</script>

<template>
    <div class="tree">
        <div class="head" :class="{ drop: dropFolder === '' }" @dragover="onDragOver('', $event)"
            @dragleave="onDragLeave('')" @drop="onDrop('', $event)">
            <span>{{ dragging ? 'ここにドロップするとリポジトリの直下へ' : '文書' }}</span>
            <span class="cd-grow" />
            <UButton icon="i-lucide-plus" size="xs" color="neutral" variant="ghost" title="新しい文書" @click="newDocIn()" />
            <PaneControls v-if="pane" :pane="pane" side="left" label="文書・目次" />
        </div>
        <UInput v-model="q" icon="i-lucide-search" placeholder="検索（文書名・ディレクトリ名）" size="sm" @keydown="onKey" />

        <UContextMenu :items="menu" size="sm">
            <div class="scroll" @contextmenu="onContextMenu">
                <FolderTree :root="tree" :docs="app.docs" :actions="actions" :selected-doc="selected" :query="q"
                    hide-root />
                <p v-if="app.docs.length === 0 || (words.length && !hits.length)" class="empty">
                    {{ words.length ? '見つかりません' : 'まだ文書がありません' }}</p>
            </div>
        </UContextMenu>

        <DocActionModals :actions="actions" />
    </div>
</template>

<style scoped>
.tree {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    flex: 1;
    min-height: 0;
}

.scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px 8px;
}

.head {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    color: var(--ui-text-muted);
    padding-left: 4px;
    border-radius: 6px;
}

.head.drop {
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
    outline: 1px dashed var(--ui-color-primary-500);
}

.empty {
    font-size: 12px;
    color: var(--ui-text-muted);
    padding: 4px;
    margin: 0;
}
</style>
