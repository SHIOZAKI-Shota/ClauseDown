import type { ContextMenuItem } from '@nuxt/ui'
import type { DocFile } from '@shared/api'
import { useApp } from '~/stores/app'
import { allFolders, folderOf } from '~/utils/folders'

export type DocActions = ReturnType<typeof useDocActions>

export function useDocActions() {
    const app = useApp()

    async function afterChange(from: string, to: string | null) {
        await app.refreshDocs()
        if (app.currentPath === from) {
            if (to) app.openDoc(to, app.view === 'docs' ? 'editor' : app.view)
            else {
                app.currentPath = null
                app.view = 'docs'
            }
        }
    }
    async function afterRecorded() {
        if (app.prefs.pushOnSave) await app.sync()
    }

    const pendingMove = ref<{ doc: DocFile; folder: string } | null>(null)
    function askMove(doc: DocFile, folder: string) {
        if (folderOf(doc.path) === folder) return
        pendingMove.value = { doc, folder }
    }
    async function move() {
        const m = pendingMove.value
        if (!m) return
        pendingMove.value = null
        await app.flushEditor()
        const r = await app.run(() => window.api.moveDoc(app.repoDir!, m.doc.path, m.folder))
        if (!r) return
        await afterChange(m.doc.path, r.path)
        app.notify(`「${m.doc.title}」を${m.folder ? `「${m.folder}」` : 'リポジトリの直下'}へ移動しました`)
        if (r.recorded) await afterRecorded()
    }

    async function copy(doc: DocFile) {
        await app.flushEditor()
        const to = await app.run(() => window.api.copyDoc(app.repoDir!, doc.path))
        if (!to) return
        await app.refreshDocs()
        app.openDoc(to)
        app.notify(`「${doc.title}」をコピーしました。確認して「版を保存」してください`)
    }

    async function copyToRepo(doc: DocFile, dir: string, name: string) {
        await app.flushEditor()
        const to = await app.run(() => window.api.copyDocToRepo(app.repoDir!, doc.path, dir))
        if (to) app.notify(`「${doc.title}」を「${name}」の ${to} にコピーしました。そのリポジトリで「版を保存」してください`)
    }

    const pendingDelete = ref<DocFile | null>(null)
    async function remove() {
        const d = pendingDelete.value
        if (!d) return
        pendingDelete.value = null
        await app.flushEditor()
        const r = await app.run(() => window.api.deleteDoc(app.repoDir!, d.path))
        if (!r) return
        await afterChange(d.path, null)
        app.notify(`「${d.title}」を削除しました`)
        if (r.recorded) await afterRecorded()
    }

    const folders = computed(() => allFolders(app.docs))
    const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'

    function docMenu(d: DocFile, extra: ContextMenuItem[] = []): ContextMenuItem[][] {
        const here = folderOf(d.path)
        const others = (app.settings?.repos ?? []).filter((r) => r.dir !== app.repoDir)
        const moveTo = [
            ...folders.value.filter((f) => f !== here).map((f) => ({ label: f, icon: 'i-lucide-folder', onSelect: () => askMove(d, f) })),
            ...(here ? [{ label: 'リポジトリの直下', icon: 'i-lucide-folder-root', onSelect: () => askMove(d, '') }] : []),
        ]
        return [
            [{ label: '開く', icon: 'i-lucide-file-text', onSelect: () => app.openDoc(d.path) }, ...extra],
            [
                { label: 'コピー', icon: 'i-lucide-copy', onSelect: () => copy(d) },
                { label: '別のディレクトリへ移動', icon: 'i-lucide-folder-input', disabled: !moveTo.length, children: moveTo },
                {
                    label: '他のリポジトリにコピー',
                    icon: 'i-lucide-archive',
                    disabled: !others.length,
                    children: others.map((r) => ({
                        label: r.name,
                        icon: missing(r.dir) ? 'i-lucide-folder-x' : 'i-lucide-archive',
                        disabled: missing(r.dir),
                        onSelect: () => copyToRepo(d, r.dir, r.name),
                    })),
                },
            ],
            [{ label: 'エクスプローラーで表示', icon: 'i-lucide-folder-open', onSelect: () => app.run(() => window.api.showDocInFolder(app.repoDir!, d.path)) }],
            [{ label: '削除', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (pendingDelete.value = d) }],
        ]
    }

    const dragging = ref<DocFile | null>(null)
    const dropFolder = ref<string | null>(null)
    function onDragStart(d: DocFile, e: DragEvent) {
        dragging.value = d
        e.dataTransfer?.setData('text/plain', d.title)
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    }
    function onDragEnd() {
        dragging.value = null
        dropFolder.value = null
    }
    function onDragOver(folder: string, e: DragEvent) {
        if (!dragging.value) return
        e.preventDefault()
        e.stopPropagation()
        const same = folderOf(dragging.value.path) === folder
        if (e.dataTransfer) e.dataTransfer.dropEffect = same ? 'none' : 'move'
        dropFolder.value = same ? null : folder
    }
    function onDragLeave(folder: string) {
        if (dropFolder.value === folder) dropFolder.value = null
    }
    function onDrop(folder: string, e?: DragEvent) {
        e?.stopPropagation()
        const d = dragging.value
        onDragEnd()
        if (d) askMove(d, folder)
    }

    return {
        pendingMove,
        move,
        pendingDelete,
        remove,
        docMenu,
        dragging,
        dropFolder,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDragLeave,
        onDrop,
    }
}
