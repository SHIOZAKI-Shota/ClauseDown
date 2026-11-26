import type { Signer } from '@libpdf/core'
import { errText } from './util'
import { t } from '../shared/i18n'
import type { MynaStatus } from '../shared/api'
import { loadNative } from './native'

export interface MynaSession {
	certificate: Uint8Array
	caCertificate: Uint8Array
	sign(digest: Uint8Array): Promise<Uint8Array>
	close(): Promise<void>
}

export interface MynaNative {
	status(): Promise<MynaStatus>
	openSession(pin: string): Promise<MynaSession>
}

let native: MynaNative | null | undefined

function load(): MynaNative | null {
	if (native === undefined) native = loadNative<MynaNative>('myna')
	return native
}

export function setMynaNative(n: MynaNative | null): void {
	native = n
}

export async function mynaAvailable(): Promise<boolean> {
	return !!load()
}

export async function mynaStatus(): Promise<MynaStatus> {
	const n = load()
	if (!n) return { available: false, reader: null, card: false, signCert: false, retries: null }
	try {
		const st = await n.status()
		return { available: true, reader: st.reader ?? null, card: !!st.card, signCert: !!st.signCert, retries: st.retries ?? null }
	} catch (e) {
		return { available: true, reader: null, card: false, signCert: false, retries: null, error: errText(e) }
	}
}

const PIN_RE = /^[0-9A-Z]{6,16}$/

export async function openMynaSigner(pin: string): Promise<{ signer: Signer; close: () => Promise<void> }> {
	const n = load()
	if (!n) throw new Error(t().signing.errors.mynaMissing)
	const p = String(pin ?? '').toUpperCase()
	if (!PIN_RE.test(p)) throw new Error(t().signing.errors.mynaPinFormat)
	let session: MynaSession
	try {
		session = await n.openSession(p)
	} catch (e) {
		throw new Error(t().signing.errors.myna(errText(e)))
	}
	const signer: Signer = {
		certificate: new Uint8Array(session.certificate),
		certificateChain: session.caCertificate?.length ? [new Uint8Array(session.caCertificate)] : [],
		keyType: 'RSA',
		signatureAlgorithm: 'RSASSA-PKCS1-v1_5',
		async sign(data, algorithm) {
			if (algorithm !== 'SHA-256') throw new Error(t().signing.errors.myna(algorithm))
			const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(data)))
			return new Uint8Array(await session.sign(digest))
		},
	}
	return { signer, close: () => session.close().catch(() => {}) }
}
