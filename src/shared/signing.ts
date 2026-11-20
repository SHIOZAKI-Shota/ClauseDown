import { cleanMdSigning, DEFAULT_MD_SIGNING, type MdSigningSettings } from './mdsig'
export type CommitSignMode = 'off' | 'app' | 'external'
export type PdfCertKind = 'p12' | 'self' | 'myna'

export interface PdfCertEntry {
    id: string
    label: string
    kind: PdfCertKind
    cert?: CertInfo
    selfCert?: string
    reason?: string
    location?: string
    contactInfo?: string
}

export const MAX_PDF_CERTS = 10
export const CERT_ID_RE = /^[a-z0-9]{12}$/
export const LEGACY_CERT_ID: Record<PdfCertKind, string> = { p12: 'legacyp12000', self: 'legacyself00', myna: 'legacymyna00' }

export type KeyStorage = 'app' | 'chip'

export interface SshKeyInfo {
    fingerprint: string
    publicKey: string
    createdAt: string
    storage?: KeyStorage
}

export interface CertInfo {
    subject: string
    issuer: string
    email: string
    notBefore: string
    notAfter: string
    selfSigned: boolean
    fingerprint: string
}

export interface TsaPreset {
    id: string
    url: string
    certified: boolean
    auth: boolean
}

export const TSA_PRESETS: TsaPreset[] = [
    { id: 'digicert', url: 'http://timestamp.digicert.com', certified: false, auth: false },
    { id: 'freetsa', url: 'https://freetsa.org/tsr', certified: false, auth: false },
    { id: 'seiko', url: '', certified: true, auth: true },
    { id: 'amano', url: '', certified: true, auth: true },
    { id: 'diastamp', url: '', certified: true, auth: true },
    { id: 'gmo', url: '', certified: true, auth: true },
    { id: 'custom', url: '', certified: false, auth: true },
]

export interface SigningSettings {
    commit: {
        mode: CommitSignMode
        key?: SshKeyInfo
        previousKeys?: string[]
        registered: Record<string, { at: string; manual?: boolean }>
        localMerge: boolean
    }
    approvals: { sign: boolean }
    pdf: {
        certs: PdfCertEntry[]
        defaultCert?: string
        repoCerts: Record<string, string>
        onExport: boolean
        onDeliver: boolean
        reason: string
        location: string
        contactInfo: string
        tsa: { enabled: boolean; preset: string; url: string; user: string }
        longTerm: boolean
    }
    md: MdSigningSettings
}

export const DEFAULT_SIGNING: SigningSettings = {
    commit: { mode: 'app', registered: {}, localMerge: false },
    approvals: { sign: true },
    pdf: {
        certs: [],
        repoCerts: {},
        onExport: true,
        onDeliver: true,
        reason: '',
        location: '',
        contactInfo: '',
        tsa: { enabled: false, preset: 'digicert', url: TSA_PRESETS[0].url, user: '' },
        longTerm: false,
    },
    md: DEFAULT_MD_SIGNING,
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

const isCert = (c: unknown): c is CertInfo => !!c && typeof c === 'object' && typeof (c as CertInfo).fingerprint === 'string'

interface LegacyPdf {
    method?: string
    cert?: CertInfo
    selfCert?: string
}

function legacyCerts(p: LegacyPdf): PdfCertEntry[] {
    if (p.method === 'p12' && isCert(p.cert)) return [{ id: LEGACY_CERT_ID.p12, label: p.cert.subject, kind: 'p12', cert: p.cert }]
    if (p.method === 'self' && isCert(p.cert) && typeof p.selfCert === 'string')
        return [{ id: LEGACY_CERT_ID.self, label: p.cert.subject, kind: 'self', cert: p.cert, selfCert: p.selfCert }]
    if (p.method === 'myna') return [{ id: LEGACY_CERT_ID.myna, label: '', kind: 'myna' }]
    return []
}

function cleanCerts(p: Partial<SigningSettings['pdf']> & LegacyPdf): Pick<SigningSettings['pdf'], 'certs' | 'defaultCert' | 'repoCerts'> {
    const raw = Array.isArray(p.certs) ? p.certs : legacyCerts(p)
    const certs: PdfCertEntry[] = []
    for (const c of raw) {
        if (!c || typeof c !== 'object' || !CERT_ID_RE.test(String(c.id))) continue
        if (c.kind !== 'p12' && c.kind !== 'self' && c.kind !== 'myna') continue
        if (certs.some((x) => x.id === c.id || (c.kind === 'myna' && x.kind === 'myna'))) continue
        if (c.kind !== 'myna' && !isCert(c.cert)) continue
        if (c.kind === 'self' && typeof c.selfCert !== 'string') continue
        certs.push({
            id: c.id,
            label: text(c.label, 80),
            kind: c.kind,
            ...(c.kind !== 'myna' ? { cert: c.cert } : {}),
            ...(c.kind === 'self' ? { selfCert: c.selfCert } : {}),
            ...(c.reason ? { reason: text(c.reason) } : {}),
            ...(c.location ? { location: text(c.location) } : {}),
            ...(c.contactInfo ? { contactInfo: text(c.contactInfo) } : {}),
        })
        if (certs.length >= MAX_PDF_CERTS) break
    }
    const has = (id: unknown): id is string => typeof id === 'string' && certs.some((c) => c.id === id)
    const legacyDefault = !Array.isArray(p.certs) ? certs[0]?.id : undefined
    const repoCerts: Record<string, string> = {}
    if (p.repoCerts && typeof p.repoCerts === 'object')
        for (const [dir, id] of Object.entries(p.repoCerts).slice(0, 500)) if (dir && has(id)) repoCerts[dir] = id
    return { certs, defaultCert: has(p.defaultCert) ? p.defaultCert : legacyDefault, repoCerts }
}

export function resolveCert(pdf: SigningSettings['pdf'], dir?: string): PdfCertEntry | undefined {
    const byId = (id?: string) => (id ? pdf.certs.find((c) => c.id === id) : undefined)
    return byId(dir ? pdf.repoCerts[dir] : undefined) ?? byId(pdf.defaultCert) ?? pdf.certs[0]
}

export function cleanSigning(v: unknown): SigningSettings {
    const s = (v && typeof v === 'object' ? v : {}) as Partial<SigningSettings>
    const c = (s.commit ?? {}) as Partial<SigningSettings['commit']>
    const p = (s.pdf ?? {}) as Partial<SigningSettings['pdf']> & LegacyPdf
    const tsa = (p.tsa ?? {}) as Partial<SigningSettings['pdf']['tsa']>
    const preset = TSA_PRESETS.some((x) => x.id === tsa.preset) ? tsa.preset! : DEFAULT_SIGNING.pdf.tsa.preset
    return {
        commit: {
            mode: c.mode === 'off' || c.mode === 'external' ? c.mode : 'app',
            key:
                c.key && typeof c.key.fingerprint === 'string' && typeof c.key.publicKey === 'string'
                    ? {
                          fingerprint: c.key.fingerprint,
                          publicKey: c.key.publicKey,
                          createdAt: text(c.key.createdAt, 40),
                          storage: c.key.storage === 'chip' ? 'chip' : 'app',
                      }
                    : undefined,
            registered: c.registered && typeof c.registered === 'object' ? c.registered : {},
            previousKeys: Array.isArray(c.previousKeys) ? c.previousKeys.filter((k): k is string => typeof k === 'string').slice(-10) : [],
            localMerge: bool(c.localMerge, false),
        },
        approvals: { sign: bool(s.approvals?.sign, true) },
        pdf: {
            ...cleanCerts(p),
            onExport: bool(p.onExport, true),
            onDeliver: bool(p.onDeliver, true),
            reason: text(p.reason),
            location: text(p.location),
            contactInfo: text(p.contactInfo),
            tsa: { enabled: bool(tsa.enabled, false), preset, url: text(tsa.url, 500), user: text(tsa.user) },
            longTerm: bool(p.longTerm, false),
        },
        md: cleanMdSigning(s.md),
    }
}

export type SigState = 'verified' | 'unknown-key' | 'bad' | 'pgp' | 'none'

export interface SigInfo {
    state: SigState
    fingerprint?: string
    signer?: { login?: string; name?: string; source: 'own' | 'forge' | 'repo' | 'policy' }
}
