import { t } from './i18n'
import type { ForgeKind } from './forge'
import { liveRecord } from './i18n/live'
import type { DsseEnvelope } from './attestation'

export type ReviewAction = 'request' | 'approve' | 'changes' | 'comment' | 'withdraw'

export interface ReviewEvent {
    id: string
    branch: string
    action: ReviewAction
    oid: string
    by: string
    byLogin?: string
    at: string
    text: string
    source?: 'app' | ForgeKind
    githubPr?: number
    pr?: number
    forge?: ForgeKind
    forgeUser?: string
    attestation?: DsseEnvelope
    publicKey?: string
    mirror?: { forge: ForgeKind; pr: number }
    signed?: 'verified' | 'unverified'
}

export const isPrNumber = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

export function prOf(e: ReviewEvent | undefined): number | undefined {
    const v: unknown = e?.pr ?? e?.githubPr
    return isPrNumber(v) ? v : undefined
}

export interface RepoRules {
    requireApproval: boolean
    approvers: string[]
    requireSignedApproval?: boolean
    approvalThreshold?: number
    approverKeys?: Record<string, { publicKey: string; validFrom: string; validUntil?: string }[]>
}

export interface Reviewer {
    name?: string
    login?: string
}

const sameLogin = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export function isApprover(approvers: string[], who: Reviewer): boolean {
    return approvers.some((a) => {
        const v = a.trim()
        return v.startsWith('@') ? sameLogin(v.slice(1), who.login) : !!who.name && v === who.name
    })
}

export function reviewerOf(e: ReviewEvent): Reviewer {
    return e.source === 'github' || e.source === 'gitlab' ? { login: e.by } : { name: e.by, login: e.byLogin }
}

function isRequester(request: ReviewEvent, who: Reviewer): boolean {
    const login = request.byLogin ?? request.forgeUser
    if (login && who.login) return sameLogin(login, who.login)
    return !!who.name && request.source !== 'github' && request.source !== 'gitlab' && request.by === who.name
}

export const DEFAULT_RULES: RepoRules = { requireApproval: false, approvers: [] }

export type ReviewState = 'none' | 'requested' | 'approved' | 'changes' | 'outdated'

export interface ReviewStatus {
    state: ReviewState
    request?: ReviewEvent
    decision?: ReviewEvent
    events: ReviewEvent[]
    canMerge: boolean
    reason?: string
    approvals?: number
    needed?: number
}

// 読むたびに今の言語で返す
export const STATE_LABEL: Record<ReviewState, string> = liveRecord(['none', 'requested', 'approved', 'changes', 'outdated'], (s) => t().labels.reviewState[s])

export const STATE_COLOR: Record<ReviewState, 'success' | 'error' | 'warning' | 'neutral'> = {
    none: 'neutral',
    requested: 'warning',
    approved: 'success',
    changes: 'error',
    outdated: 'warning',
}

export function canApprove(who: Reviewer, request: ReviewEvent | undefined, rules: RepoRules, source?: string): boolean {
    if (rules.approvers.length) return isApprover(rules.approvers, who)
    if (source === 'github') return true
    return !!request && !isRequester(request, who)
}

const timeOf = (e: ReviewEvent) => {
    const t = Date.parse(e.at)
    return Number.isNaN(t) ? 0 : t
}

const byTime = (a: ReviewEvent, b: ReviewEvent) => timeOf(a) - timeOf(b) || Number(b.action === 'request') - Number(a.action === 'request')

export function reviewStatus(all: ReviewEvent[], branch: string, tipOid: string, rules: RepoRules): ReviewStatus {
    const events = all.filter((e) => e.branch === branch && !e.mirror).sort(byTime)
    let request: ReviewEvent | undefined
    const latest = new Map<string, ReviewEvent>()
    let unsigned = false
    for (const e of events) {
        if (e.action === 'request') {
            request = e
            latest.clear()
            unsigned = false
        } else if (e.action === 'withdraw') {
            request = undefined
            latest.clear()
        } else if (request && (e.action === 'approve' || e.action === 'changes')) {
            const who = reviewerOf(e)
            if (e.action === 'approve' && !canApprove(who, request, rules, e.source)) continue
            if (e.action === 'approve' && rules.requireSignedApproval && e.signed !== 'verified') {
                unsigned = true
                continue
            }
            latest.set((who.login ?? who.name ?? '').toLowerCase(), e)
        }
    }
    const needed = Math.max(1, Math.round(rules.approvalThreshold ?? 1))
    const decisions = [...latest.values()].sort(byTime)
    const changes = decisions.filter((d) => d.action === 'changes').at(-1)
    const fresh = decisions.filter((d) => d.action === 'approve' && d.oid === tipOid)
    const stale = decisions.filter((d) => d.action === 'approve' && d.oid !== tipOid)
    let state: ReviewState = 'none'
    let decision: ReviewEvent | undefined
    if (request) {
        if (changes) {
            state = 'changes'
            decision = changes
        } else if (fresh.length >= needed) {
            state = 'approved'
            decision = fresh.at(-1)
        } else if (!fresh.length && stale.length) {
            state = 'outdated'
            decision = stale.at(-1)
        } else {
            state = 'requested'
            decision = fresh.at(-1)
        }
    }
    const status: ReviewStatus = { state, request, decision, events, canMerge: true, approvals: fresh.length, needed }
    if (rules.requireApproval && state !== 'approved') {
        status.canMerge = false
        const blocked = t().labels.reviewBlocked
        status.reason =
            state === 'none'
                ? blocked.none
                : state === 'outdated'
                  ? blocked.outdated
                  : state === 'changes'
                    ? blocked.changes
                    : fresh.length
                      ? blocked.partial(fresh.length, needed)
                      : unsigned
                        ? blocked.unsigned
                        : blocked.requested
    }
    return status
}
