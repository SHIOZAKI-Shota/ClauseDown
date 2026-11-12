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
    source?: 'app' | 'github' | 'gitlab'
    githubPr?: number
    pr?: number
    forge?: 'github' | 'gitlab'
    forgeUser?: string
}

export const prOf = (e: ReviewEvent | undefined) => e?.pr ?? e?.githubPr

export interface RepoRules {
    requireApproval: boolean
    approvers: string[]
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
}

export const STATE_LABEL: Record<ReviewState, string> = {
    none: '確認依頼なし',
    requested: '確認待ち',
    approved: '承認済み',
    changes: '修正依頼あり',
    outdated: '承認後に変更あり',
}

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
    const events = all.filter((e) => e.branch === branch).sort(byTime)
    let request: ReviewEvent | undefined
    let decision: ReviewEvent | undefined
    for (const e of events) {
        if (e.action === 'request') {
            request = e
            decision = undefined
        } else if (e.action === 'withdraw') {
            request = undefined
            decision = undefined
        } else if (request && (e.action === 'approve' || e.action === 'changes')) {
            if (e.action === 'approve' && !canApprove(reviewerOf(e), request, rules, e.source)) continue
            decision = e
        }
    }
    let state: ReviewState = 'none'
    if (request) {
        if (!decision) state = 'requested'
        else if (decision.action === 'changes') state = 'changes'
        else state = decision.oid === tipOid ? 'approved' : 'outdated'
    }
    const status: ReviewStatus = { state, request, decision, events, canMerge: true }
    if (rules.requireApproval && state !== 'approved') {
        status.canMerge = false
        status.reason =
            state === 'none'
                ? 'このリポジトリでは、現行版に反映する前に確認と承認が必要です。「確認を依頼」してください'
                : state === 'outdated'
                  ? '承認したあとで改定案が変更されています。もう一度承認を受けてください'
                  : state === 'changes'
                    ? '修正の依頼が出ています。直して再度確認を依頼してください'
                    : 'まだ承認されていません'
    }
    return status
}
