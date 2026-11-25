import type { Ref } from 'vue'
import { useApp } from '~/stores/app'
import { ipcError, toPlain } from '~/utils/ipc'

export function usePrintPreview(o: { on: Ref<boolean>; ready: Ref<boolean>; source: Ref<string>; path: string }) {
    const app = useApp()
    const pdfData = shallowRef<Uint8Array | null>(null)
    const pdfBusy = ref(false)
    const pdfError = ref('')
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    async function makePdf() {
        const n = ++seq
        pdfBusy.value = true
        try {
            const bytes = await window.api.previewPdf(o.source.value, toPlain(app.style), { dir: app.repoDir!, docPath: o.path })
            if (n !== seq) return
            pdfData.value = bytes
            pdfError.value = ''
        } catch (e) {
            if (n === seq) pdfError.value = ipcError(e)
        } finally {
            if (n === seq) pdfBusy.value = false
        }
    }
    watch(
        () => [o.on.value, o.source.value, app.style] as const,
        ([on]) => {
            clearTimeout(timer)
            if (on && o.ready.value) timer = setTimeout(() => void makePdf(), pdfData.value ? 900 : 0)
        },
        { deep: true },
    )
    watch(o.ready, (v) => v && o.on.value && void makePdf())
    onBeforeUnmount(() => clearTimeout(timer))
    return { pdfData, pdfBusy, pdfError }
}
