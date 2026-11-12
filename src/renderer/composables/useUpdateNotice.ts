import type { UpdateState } from '@shared/api'
import { useApp } from '~/stores/app'

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
        if (u.state === 'downloading') app.notify('ダウンロードを始めました。終わったらお知らせします')
    }

    async function install() {
        await app.flushEditor()
        await window.api.installUpdate()
    }

    function showAvailable(u: UpdateState) {
        toast.add({
            id: 'update',
            title: `ClauseDown ${u.version} が出ました`,
            description: `今お使いのバージョンは ${u.current} です`,
            icon: 'i-lucide-circle-arrow-up',
            color: 'primary',
            duration: 0,
            actions: [
                { label: IS_MAC ? '配布ページを開く' : 'ダウンロード', icon: 'i-lucide-download', size: 'sm', onClick: () => void download() },
                { label: '変更点を見る', size: 'sm', color: 'neutral', variant: 'outline', onClick: () => (app.view = 'about') },
            ],
        })
    }

    function showReady(u: UpdateState) {
        toast.add({
            id: 'update',
            title: `ClauseDown ${u.version} の準備ができました`,
            description: '再起動すると新しいバージョンになります',
            icon: 'i-lucide-circle-arrow-up',
            color: 'primary',
            duration: 0,
            actions: [{ label: '再起動して更新', icon: 'i-lucide-rotate-cw', size: 'sm', onClick: () => void install() }],
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
