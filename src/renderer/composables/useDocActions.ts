import type { ContextMenuItem } from '@nuxt/ui'
import type { DocFile } from '@shared/api'
import { useApp } from '~/stores/app'
import { allFolders, folderOf } from '~/utils/folders'
import { revealLabel } from '~/utils/platform'
import { t } from '@shared/i18n'

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
		app.notify(t().shell.docActions.moved(m.doc.title, m.folder))
		if (r.recorded) await afterRecorded()
	}

	async function copy(doc: DocFile) {
		await app.flushEditor()
		const to = await app.run(() => window.api.copyDoc(app.repoDir!, doc.path))
		if (!to) return
		await app.refreshDocs()
		app.openDoc(to)
		app.notify(t().shell.docActions.copied(doc.title))
	}

	async function copyToRepo(doc: DocFile, dir: string, name: string) {
		await app.flushEditor()
		const to = await app.run(() => window.api.copyDocToRepo(app.repoDir!, doc.path, dir))
		if (to) app.notify(t().shell.docActions.copiedToRepo(doc.title, name, to))
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
		app.notify(t().shell.docActions.deleted(d.title))
		if (r.recorded) await afterRecorded()
	}

	const folders = computed(() => allFolders(app.docs))
	const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'

	function docMenu(d: DocFile, extra: ContextMenuItem[] = []): ContextMenuItem[][] {
		const m = t()
		const here = folderOf(d.path)
		const others = (app.settings?.repos ?? []).filter((r) => r.dir !== app.repoDir)
		const moveTo = [
			...folders.value.filter((f) => f !== here).map((f) => ({ label: f, icon: 'i-lucide-folder', onSelect: () => askMove(d, f) })),
			...(here ? [{ label: m.shell.docActions.root, icon: 'i-lucide-folder-root', onSelect: () => askMove(d, '') }] : []),
		]
		return [
			[{ label: m.common.open, icon: 'i-lucide-file-text', onSelect: () => app.openDoc(d.path) }, ...extra],
			[
				{ label: m.common.copy, icon: 'i-lucide-copy', onSelect: () => copy(d) },
				{ label: m.shell.docActions.moveTo, icon: 'i-lucide-folder-input', disabled: !moveTo.length, children: moveTo },
				{
					label: m.shell.docActions.copyToRepo,
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
			[
				{
					label: revealLabel(),
					icon: 'i-lucide-folder-open',
					onSelect: () => app.run(() => window.api.showDocInFolder(app.repoDir!, d.path)),
				},
			],
			[{ label: m.common.delete, icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (pendingDelete.value = d) }],
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
