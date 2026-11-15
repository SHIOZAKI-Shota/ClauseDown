import type { MynaStatus, SigningStatus } from '@shared/api'

const status = ref<SigningStatus | null>(null)
const prompt = ref<{ name: string; myna: MynaStatus | null; resolve: (pin: string | null) => void } | null>(null)

export function usePdfSign() {
    async function load(): Promise<SigningStatus | null> {
        status.value = await window.api.signingStatus().catch(() => null)
        return status.value
    }

    const ready = computed(() => (status.value?.signing.pdf.method ?? 'none') !== 'none')

    async function plan(kind: 'export' | 'deliver', name: string, want?: boolean): Promise<{ sign: boolean; pin?: string } | null> {
        const s = (await load())?.signing.pdf
        if (!s || s.method === 'none') return { sign: false }
        const sign = want ?? (kind === 'export' ? s.onExport : s.onDeliver)
        if (!sign) return { sign: false }
        if (s.method !== 'myna') return { sign: true }
        const myna = await window.api.mynaStatus().catch(() => null)
        const pin = await new Promise<string | null>((resolve) => (prompt.value = { name, myna, resolve }))
        prompt.value = null
        return pin ? { sign: true, pin } : null
    }

    return { status, ready, load, plan, prompt }
}
