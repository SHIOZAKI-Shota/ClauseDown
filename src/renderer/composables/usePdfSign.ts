import type { MynaStatus, SigningStatus } from '@shared/api'
import { resolveCert, type PdfCertEntry } from '@shared/signing'

export interface SignPrompt {
	name: string
	certs: PdfCertEntry[]
	certId: string
	askCert: boolean
	myna: MynaStatus | null
	resolve: (r: { certId: string; pin?: string } | null) => void
}

const status = ref<SigningStatus | null>(null)
const prompt = ref<SignPrompt | null>(null)

export function usePdfSign() {
	async function load(): Promise<SigningStatus | null> {
		status.value = await window.api.signingStatus().catch(() => null)
		return status.value
	}

	const certs = computed(() => status.value?.signing.pdf.certs ?? [])
	const ready = computed(() => certs.value.length > 0)
	const defaultFor = (dir?: string) => (status.value ? resolveCert(status.value.signing.pdf, dir)?.id : undefined)

	async function plan(
		kind: 'export' | 'deliver',
		name: string,
		want?: boolean,
		opts: { dir?: string; certId?: string } = {},
	): Promise<{ sign: boolean; certId?: string; pin?: string } | null> {
		const pdf = (await load())?.signing.pdf
		if (!pdf?.certs.length) return { sign: false }
		const sign = want ?? (kind === 'export' ? pdf.onExport : pdf.onDeliver)
		if (!sign) return { sign: false }
		const certId = (opts.certId && pdf.certs.some((c) => c.id === opts.certId) ? opts.certId : resolveCert(pdf, opts.dir)?.id) ?? pdf.certs[0].id
		const askCert = !opts.certId && pdf.certs.length > 1
		if (!askCert && pdf.certs.find((c) => c.id === certId)?.kind !== 'myna') return { sign: true, certId }
		const myna = pdf.certs.some((c) => c.kind === 'myna') ? await window.api.mynaStatus().catch(() => null) : null
		const r = await new Promise<{ certId: string; pin?: string } | null>(
			(resolve) => (prompt.value = { name, certs: pdf.certs, certId, askCert, myna, resolve }),
		)
		prompt.value = null
		return r ? { sign: true, ...r } : null
	}

	return { status, certs, ready, defaultFor, load, plan, prompt }
}
