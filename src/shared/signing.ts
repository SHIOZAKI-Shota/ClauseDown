export type CommitSignMode = 'off' | 'app' | 'external'
export type PdfSignMethod = 'none' | 'p12' | 'self' | 'myna'

export interface SshKeyInfo {
    fingerprint: string
    publicKey: string
    createdAt: string
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
        method: PdfSignMethod
        onExport: boolean
        onDeliver: boolean
        reason: string
        location: string
        contactInfo: string
        cert?: CertInfo
        selfCert?: string
        tsa: { enabled: boolean; preset: string; url: string; user: string }
        longTerm: boolean
    }
}

export const DEFAULT_SIGNING: SigningSettings = {
    commit: { mode: 'app', registered: {}, localMerge: false },
    approvals: { sign: true },
    pdf: {
        method: 'none',
        onExport: true,
        onDeliver: true,
        reason: '',
        location: '',
        contactInfo: '',
        tsa: { enabled: false, preset: 'digicert', url: TSA_PRESETS[0].url, user: '' },
        longTerm: false,
    },
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')

export function cleanSigning(v: unknown): SigningSettings {
    const s = (v && typeof v === 'object' ? v : {}) as Partial<SigningSettings>
    const c = (s.commit ?? {}) as Partial<SigningSettings['commit']>
    const p = (s.pdf ?? {}) as Partial<SigningSettings['pdf']>
    const tsa = (p.tsa ?? {}) as Partial<SigningSettings['pdf']['tsa']>
    const preset = TSA_PRESETS.some((x) => x.id === tsa.preset) ? tsa.preset! : DEFAULT_SIGNING.pdf.tsa.preset
    return {
        commit: {
            mode: c.mode === 'off' || c.mode === 'external' ? c.mode : 'app',
            key: c.key && typeof c.key.fingerprint === 'string' && typeof c.key.publicKey === 'string' ? c.key : undefined,
            registered: c.registered && typeof c.registered === 'object' ? c.registered : {},
            previousKeys: Array.isArray(c.previousKeys) ? c.previousKeys.filter((k): k is string => typeof k === 'string').slice(-10) : [],
            localMerge: bool(c.localMerge, false),
        },
        approvals: { sign: bool(s.approvals?.sign, true) },
        pdf: {
            method: p.method === 'p12' || p.method === 'self' || p.method === 'myna' ? p.method : 'none',
            onExport: bool(p.onExport, true),
            onDeliver: bool(p.onDeliver, true),
            reason: text(p.reason),
            location: text(p.location),
            contactInfo: text(p.contactInfo),
            cert: p.cert && typeof p.cert.fingerprint === 'string' ? p.cert : undefined,
            selfCert: typeof p.selfCert === 'string' ? p.selfCert : undefined,
            tsa: { enabled: bool(tsa.enabled, false), preset, url: text(tsa.url, 500), user: text(tsa.user) },
            longTerm: bool(p.longTerm, false),
        },
    }
}

export type SigState = 'verified' | 'unknown-key' | 'bad' | 'pgp' | 'none'

export interface SigInfo {
    state: SigState
    fingerprint?: string
    signer?: { login?: string; name?: string; source: 'own' | 'forge' | 'repo' | 'policy' }
}
