import type { RepoRules } from './review'

export const POLICY_TYPE = 'https://clausedown.app/policy/v1'

export interface PolicyKey {
    publicKey: string
    validFrom: string
    validUntil?: string
}

export interface PolicyPerson {
    name: string
    login?: string
    keys: PolicyKey[]
}

export interface PolicyDoc {
    _type: typeof POLICY_TYPE
    version: number
    previous: string | null
    repo: string
    requireApproval: boolean
    approvalThreshold: number
    requireSignedApproval: boolean
    approvers: PolicyPerson[]
    admins: PolicyPerson[]
    adminThreshold: number
    createdAt: string
    createdBy: string
}

export type PolicyDraft = Omit<PolicyDoc, '_type' | 'version' | 'previous' | 'repo' | 'createdAt' | 'createdBy'>

const isStr = (v: unknown): v is string => typeof v === 'string'
const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+$/

function cleanKey(v: unknown): PolicyKey | null {
    const k = v as Partial<PolicyKey> | null
    if (!k || !isStr(k.publicKey) || !isStr(k.validFrom) || Number.isNaN(Date.parse(k.validFrom))) return null
    const publicKey = k.publicKey.trim().split(/\s+/).slice(0, 2).join(' ')
    if (!KEY_RE.test(publicKey)) return null
    const out: PolicyKey = { publicKey, validFrom: k.validFrom }
    if (isStr(k.validUntil) && !Number.isNaN(Date.parse(k.validUntil))) out.validUntil = k.validUntil
    return out
}

function cleanPerson(v: unknown): PolicyPerson | null {
    const p = v as Partial<PolicyPerson> | null
    if (!p || !isStr(p.name)) return null
    const name = p.name.trim().slice(0, 100)
    const login = isStr(p.login) && p.login.trim() ? p.login.trim().replace(/^@/, '').slice(0, 100) : undefined
    if (!name && !login) return null
    const keys = Array.isArray(p.keys) ? p.keys.map(cleanKey).filter((k): k is PolicyKey => !!k) : []
    return { name: name || login!, ...(login ? { login } : {}), keys }
}

const people = (v: unknown) => (Array.isArray(v) ? v.map(cleanPerson).filter((p): p is PolicyPerson => !!p) : [])
const count = (v: unknown, max: number) => Math.min(Math.max(1, Math.round(Number(v) || 1)), Math.max(1, max))

export function cleanDraft(v: unknown): PolicyDraft {
    const d = (v ?? {}) as Partial<PolicyDraft>
    const approvers = people(d.approvers)
    const admins = people(d.admins)
    return {
        requireApproval: d.requireApproval === true,
        approvalThreshold: count(d.approvalThreshold, approvers.length || 1),
        requireSignedApproval: d.requireApproval === true && d.requireSignedApproval === true,
        approvers,
        admins,
        adminThreshold: count(d.adminThreshold, admins.length || 1),
    }
}

export function cleanPolicyDoc(v: unknown): PolicyDoc | null {
    const d = v as Partial<PolicyDoc> | null
    if (!d || d._type !== POLICY_TYPE || !Number.isSafeInteger(d.version) || (d.version as number) < 1) return null
    if (!isStr(d.repo) || !(d.previous === null || isStr(d.previous)) || !isStr(d.createdAt) || !isStr(d.createdBy)) return null
    const draft = cleanDraft(d)
    if (!draft.admins.length || draft.admins.every((a) => !a.keys.length)) return null
    return { _type: POLICY_TYPE, version: d.version!, previous: d.previous ?? null, repo: d.repo, ...draft, createdAt: d.createdAt, createdBy: d.createdBy }
}

export function keyValidAt(k: PolicyKey, at: string | number | Date): boolean {
    const t = new Date(at).getTime()
    if (Number.isNaN(t)) return false
    if (t < Date.parse(k.validFrom) - 5 * 60_000) return false
    return !k.validUntil || t <= Date.parse(k.validUntil)
}

export const personId = (p: { name?: string; login?: string }) => (p.login ? `@${p.login}` : (p.name ?? ''))

export function rulesOf(doc: PolicyDoc): RepoRules {
    const approverKeys: Record<string, PolicyKey[]> = {}
    for (const a of doc.approvers) if (a.keys.length) approverKeys[personId(a)] = a.keys
    return {
        requireApproval: doc.requireApproval,
        approvers: doc.approvers.map(personId),
        requireSignedApproval: doc.requireSignedApproval,
        approvalThreshold: doc.approvalThreshold,
        approverKeys,
    }
}

export function draftOf(doc: PolicyDoc): PolicyDraft {
    const { requireApproval, approvalThreshold, requireSignedApproval, approvers, admins, adminThreshold } = doc
    return structuredClone({ requireApproval, approvalThreshold, requireSignedApproval, approvers, admins, adminThreshold })
}
