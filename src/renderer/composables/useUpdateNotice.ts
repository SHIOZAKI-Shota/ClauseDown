import type { UpdateState } from '@shared/api'
import { useApp } from '~/stores/app'
import { t } from '@shared/i18n'

// 起動してから更新を確認するまでの間。起動直後の読み込みや同期と重ならないようにする
const DELAY = 5000

// 起動したら裏で更新を確認し、新しいバージョンがあればトーストで知らせる。
// 更新するまで、起動のたびに知らせる。
export function useUpdateNotice() {
	const app = useApp()
	const toast = useToast()
	let fromToast = false

	async function download() {
		fromToast = true
		const u = await window.api.downloadUpdate()
		if (u.state === 'downloading') app.notify(t().shell.update.started)
	}

	async function install() {
		await app.flushEditor()
		await window.api.installUpdate()
	}

	function showAvailable(u: UpdateState) {
		const m = t().shell.update
		toast.add({
			id: 'update',
			title: m.availableTitle(u.version),
			description: m.availableDesc(u.current, u.via === 'brew'),
			icon: 'i-lucide-circle-arrow-up',
			color: 'primary',
			duration: 0,
			actions: [
				{
					label: u.via === 'brew' ? m.updateNow : IS_MAC ? m.openDownloadPage : m.download,
					icon: 'i-lucide-download',
					size: 'sm',
					onClick: () => void download(),
				},
				{ label: m.viewChanges, size: 'sm', color: 'neutral', variant: 'outline', onClick: () => (app.view = 'about') },
			],
		})
	}

	function showReady(u: UpdateState) {
		const m = t().shell.update
		toast.add({
			id: 'update',
			title: m.readyTitle(u.version),
			description: u.via === 'brew' ? m.readyBrew : m.readyDesc,
			icon: 'i-lucide-circle-arrow-up',
			color: 'primary',
			duration: 0,
			actions: [{ label: m.restartToUpdate, icon: 'i-lucide-rotate-cw', size: 'sm', onClick: () => void install() }],
		})
	}

	async function check() {
		if (!app.prefs.checkUpdateOnStart) return
		const u = await window.api.checkUpdate()
		if (u.state !== 'available' || !u.version) return
		showAvailable(u)
	}

	let off: (() => void) | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	onMounted(() => {
		// About の画面でダウンロードしたときは、そこに「再起動して更新」が出るので知らせない
		off = window.api.onUpdateState((u) => {
			if (u.state === 'ready' && (fromToast || app.view !== 'about')) showReady(u)
		})
		void window.api.updateState().then((u) => {
			if (u.via === 'brew' && u.state === 'error' && u.message) {
				toast.add({ id: 'update', title: t().shell.update.failed, description: u.message, icon: 'i-lucide-circle-alert', color: 'error', duration: 0 })
			}
		})
	})
	onBeforeUnmount(() => {
		off?.()
		clearTimeout(timer)
	})

	// 設定を読み込んでから呼ぶ
	return {
		start: () => {
			timer = setTimeout(() => void check(), DELAY)
		},
	}
}
