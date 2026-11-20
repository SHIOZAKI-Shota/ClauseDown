import type { Ref } from 'vue'
import type { LegalDoc } from '@shared/legal-parser'
import { isEnabled } from '@shared/experiments'
import { overallStatus, type MdVerifyReport } from '@shared/mdsig'
import { layout, locks } from '@shared/mdsig-layout'
import { useApp } from '~/stores/app'
import { ipcError } from '~/utils/ipc'

export const SIG_COLOR = { none: 'neutral', busy: 'neutral', verified: 'success', pending: 'warning', unresolved: 'warning', failed: 'error' } as const
export const SIG_ICON = {
    none: 'i-lucide-pen-line',
    busy: 'i-lucide-loader-circle',
    verified: 'i-lucide-shield-check',
    pending: 'i-lucide-shield-ellipsis',
    unresolved: 'i-lucide-shield-question',
    failed: 'i-lucide-shield-x',
} as const

export function useSignatureVerify(o: { doc: Ref<LegalDoc>; source: Ref<string>; path: string }) {
    const app = useApp()
    const cdsign = computed(() => isEnabled(app.settings, 'cdsign'))
    const sigReport = shallowRef<MdVerifyReport | null>(null)
    const sigBusy = ref(false)
    const sigState = computed(() => (sigBusy.value ? 'busy' : overallStatus(sigReport.value)))
    const sigCount = computed(() => o.doc.value.signatures?.count ?? 0)
    const sigFull = computed(() => cdsign.value && !!o.doc.value.signatures && locks(layout(o.source.value)).kind === 'full')
    let seq = 0
    async function verifySignatures() {
        const n = ++seq
        if (!cdsign.value || !app.repoDir || !o.doc.value.signatures) {
            sigReport.value = null
            sigBusy.value = false
            return
        }
        sigBusy.value = true
        try {
            const r = await window.api.verifyMd(app.repoDir, o.path, o.source.value)
            if (n === seq) sigReport.value = r
        } catch (e) {
            if (n === seq) app.notify(ipcError(e), true)
        } finally {
            if (n === seq) sigBusy.value = false
        }
    }
    watch([o.source, cdsign], () => void verifySignatures(), { immediate: true })
    async function trustSignature(signer: string, pubkey: string) {
        await app.run(() => window.api.trustMdKey(signer, pubkey))
        await verifySignatures()
    }
    return { cdsign, sigReport, sigBusy, sigState, sigCount, sigFull, verifySignatures, trustSignature }
}
