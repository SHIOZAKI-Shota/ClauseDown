import type { Ref } from 'vue'
import { autoMerge } from '@shared/merge3'
import { useApp } from '~/stores/app'
import { ipcError } from '~/utils/ipc'

export type SaveState = 'idle' | 'pending' | 'saved'

export function useAutosave(o: { text: Ref<string>; loaded: Ref<boolean>; path: string; flush: () => void }) {
	const app = useApp()
	const saving = ref<SaveState>('idle')
	let written = ''
	let timer: ReturnType<typeof setTimeout> | undefined
	let writing: Promise<void> = Promise.resolve()

	watch(o.text, (v) => {
		if (!o.loaded.value || v === written) return
		saving.value = 'pending'
		clearTimeout(timer)
		timer = setTimeout(() => void writeNow(), 500)
	})

	function writeNow(): Promise<void> {
		o.flush()
		clearTimeout(timer)
		writing = writing
			.then(async () => {
				const v = o.text.value
				if (v !== written) {
					await window.api.writeDoc(app.repoDir!, o.path, v)
					written = v
					app.markChanged(o.path)
				}
				if (o.text.value === written) saving.value = 'saved'
			})
			.catch((e) => {
				saving.value = 'pending'
				app.notify(app.t.editor.saveFailed(ipcError(e)), true)
			})
		return writing
	}

	function reset(content: string, state: SaveState = 'idle') {
		clearTimeout(timer)
		written = content
		o.text.value = content
		saving.value = state
	}

	async function reloadFromDisk() {
		o.flush()
		await writing
		const fresh = await window.api.readDoc(app.repoDir!, o.path)
		const mine = o.text.value
		const base = written
		written = fresh
		if (fresh === mine) {
			saving.value = 'saved'
			return
		}
		if (mine === base) return reset(fresh, 'saved')
		const merged = autoMerge(base, mine, fresh)
		if (merged !== null) o.text.value = merged
		else app.notify(app.t.editor.conflictKept, true)
		void writeNow()
	}

	app.setEditorFlush(writeNow)
	onBeforeUnmount(() => {
		app.setEditorFlush(null)
		void writeNow()
	})

	return { saving, writeNow, reset, reloadFromDisk, cancel: () => clearTimeout(timer) }
}
