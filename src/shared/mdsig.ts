import type { VerifyResult } from '@mdsig/core'
import type { Finding, Layout, Locks } from './mdsig-layout'

export type MdKeyKind = 'app' | 'passkey'
export type MdMethod = 'dns' | 'directory' | 'tofu'

export const MD_METHODS: MdMethod[] = ['dns', 'directory', 'tofu']
export const MAX_MD_KEYS = 10
export const MD_KEY_ID_RE = /^[a-z0-9]{12}$/
export const DEFAULT_SIGN_PAGE = 'https://sign.clausedown.app/'
export const CDSIGN_EXT = 'cdsign'
export const X_CLAUSEDOWN = 'x_clausedown'

export interface MdKeyEntry {
	id: string
	label: string
	kind: MdKeyKind
	method: MdMethod
	signer: string
	selector?: string
	publicKey?: string
	credential?: string
	rpId?: string
	page?: string
}

export interface MdRequirement {
	method: string
	signer: string
	role?: string
}

export interface MdSigningSettings {
	keys: MdKeyEntry[]
	defaultKey?: string
	repoKeys: Record<string, string>
	pages: string[]
	role: string
	reason: string
	tsa: boolean
	tofu: Record<string, string>
	lastRequire: MdRequirement[]
}

export const DEFAULT_MD_SIGNING: MdSigningSettings = {
	keys: [],
	repoKeys: {},
	pages: [DEFAULT_SIGN_PAGE],
	role: 'author',
	reason: '',
	tsa: false,
	tofu: {},
	lastRequire: [],
}

export interface MdVerifyReport {
	result: VerifyResult
	findings: Finding[]
	layout: Layout
	locks: Locks
}

const DNS_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const EMAIL_RE = /^[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}$/
const SELECTOR_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const isControl = (c: number) => c < 0x20 || c === 0x7f
function validTofu(s: string): boolean {
	if (s.length < 1 || s.length > 200 || /\s/.test(s)) return false
	for (let i = 0; i < s.length; i++) if (isControl(s.charCodeAt(i))) return false
	return true
}

export function validSigner(method: string, signer: string): boolean {
	if (signer.includes('--')) return false
	if (method === 'dns') return DNS_RE.test(signer)
	if (method === 'directory') return EMAIL_RE.test(signer)
	if (method === 'tofu') return validTofu(signer)
	return false
}

export const validSelector = (s: string): boolean => SELECTOR_RE.test(s)

export function isHttpsUrl(u: string): boolean {
	try {
		const url = new URL(u)
		return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
	} catch {
		return false
	}
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

function cleanKey(v: unknown): MdKeyEntry | null {
	if (!v || typeof v !== 'object') return null
	const k = v as Partial<MdKeyEntry>
	if (!MD_KEY_ID_RE.test(String(k.id))) return null
	if (k.kind !== 'app' && k.kind !== 'passkey') return null
	if (!MD_METHODS.includes(k.method as MdMethod)) return null
	const signer = str(k.signer)
	if (!validSigner(k.method!, signer)) return null
	if (k.kind === 'passkey' && (!k.publicKey || !k.credential || !k.rpId || !k.page || !isHttpsUrl(k.page))) return null
	return {
		id: k.id!,
		label: str(k.label, 80),
		kind: k.kind,
		method: k.method!,
		signer,
		...(k.method === 'dns' && k.selector && validSelector(k.selector) ? { selector: k.selector } : {}),
		...(k.publicKey ? { publicKey: str(k.publicKey, 400) } : {}),
		...(k.kind === 'passkey' ? { credential: str(k.credential, 400), rpId: str(k.rpId, 253), page: k.page } : {}),
	}
}

function cleanRequirement(v: unknown): MdRequirement | null {
	if (!v || typeof v !== 'object') return null
	const r = v as Partial<MdRequirement>
	const method = str(r.method, 20)
	const signer = str(r.signer)
	if (!validSigner(method, signer)) return null
	const role = str(r.role, 40).trim()
	return role && /^\S+$/.test(role) ? { method, signer, role } : { method, signer }
}

export function cleanMdSigning(v: unknown): MdSigningSettings {
	const s = (v && typeof v === 'object' ? v : {}) as Partial<MdSigningSettings>
	const keys: MdKeyEntry[] = []
	for (const k of Array.isArray(s.keys) ? s.keys : []) {
		const c = cleanKey(k)
		if (c && !keys.some((x) => x.id === c.id)) keys.push(c)
		if (keys.length >= MAX_MD_KEYS) break
	}
	const has = (id: unknown): id is string => typeof id === 'string' && keys.some((k) => k.id === id)
	const repoKeys: Record<string, string> = {}
	if (s.repoKeys && typeof s.repoKeys === 'object') for (const [dir, id] of Object.entries(s.repoKeys).slice(0, 500)) if (dir && has(id)) repoKeys[dir] = id
	const pages = (Array.isArray(s.pages) ? s.pages : DEFAULT_MD_SIGNING.pages).filter((p): p is string => typeof p === 'string' && isHttpsUrl(p)).slice(0, 10)
	const tofu: Record<string, string> = {}
	if (s.tofu && typeof s.tofu === 'object')
		for (const [signer, key] of Object.entries(s.tofu).slice(0, 2000)) if (typeof key === 'string' && key.length < 400) tofu[signer.slice(0, 200)] = key
	return {
		keys,
		defaultKey: has(s.defaultKey) ? s.defaultKey : undefined,
		repoKeys,
		pages: pages.length ? pages : [DEFAULT_SIGN_PAGE],
		role: typeof s.role === 'string' && /^\S{0,40}$/.test(s.role) ? s.role : DEFAULT_MD_SIGNING.role,
		reason: str(s.reason).replace(/--/g, '-'),
		tsa: typeof s.tsa === 'boolean' ? s.tsa : false,
		tofu,
		lastRequire: (Array.isArray(s.lastRequire) ? s.lastRequire : [])
			.map(cleanRequirement)
			.filter((r): r is MdRequirement => !!r)
			.slice(0, 20),
	}
}

export function resolveMdKey(md: MdSigningSettings, dir?: string): MdKeyEntry | undefined {
	const byId = (id?: string) => (id ? md.keys.find((k) => k.id === id) : undefined)
	return byId(dir ? md.repoKeys[dir] : undefined) ?? byId(md.defaultKey) ?? md.keys[0]
}

export interface AddMdKeyInput {
	kind: 'app' | 'passkey'
	label: string
	method: MdMethod
	signer: string
	selector?: string
	page?: string
}

export interface ExportCdsignInput {
	sequential?: boolean
	dir: string
	path: string
	title: string
	keyId?: string
	require: MdRequirement[]
	oid?: string
}

export interface ReceivedCdsign {
	path: string
	name: string
	report: MdVerifyReport
	check: CdsignCheck
}

export interface CdsignCheck {
	oid?: string
	bodyMatches: boolean
	ownKey: boolean
	deliveryOid: boolean
}

export type MdSigningPatch = Partial<Pick<MdSigningSettings, 'defaultKey' | 'role' | 'reason' | 'tsa' | 'pages'>> & { repo?: { dir: string; key?: string } }

export type MdOverall = 'none' | 'verified' | 'pending' | 'unresolved' | 'failed'

export function overallStatus(r: MdVerifyReport | null | undefined): MdOverall {
	if (!r || (!r.layout.blocks.length && !r.result.error)) return 'none'
	const sigs = r.result.signatures
	if (sigs.some((s) => s.status === 'invalid' || s.status === 'malformed' || s.status === 'unsupported') || r.result.agreement.status === 'violated')
		return 'failed'
	if (r.result.error) return 'failed'
	if (sigs.some((s) => s.status === 'unresolved')) return 'unresolved'
	if (!r.result.ok) return 'failed'
	return r.result.agreement.status === 'pending' ? 'pending' : 'verified'
}

export const sameBody = (body: string, source: string): boolean => normalizeText(body) === normalizeText(source)

export const normalizeText = (s: string): string =>
	s
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.replace(/[\n \t]+$/, '') + '\n'

export function requireLines(list: MdRequirement[], sequential: boolean): (MdRequirement | string)[] {
	if (!sequential || list.length < 2) return list
	return list.flatMap((r, i) => [`step ${i + 1}`, r])
}
