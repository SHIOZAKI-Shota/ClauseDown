import type { AppSettings, DeliveryRecord, Issue, IssueComment } from '@shared/api'
import type { ReviewEvent } from '@shared/review'
import type { DueEvent, EventKind } from '@shared/schedule'

export const MAIN = 'main'
export const DRAFT_PREFIX = '案/'
export const USER = 'デモの利用者'

export interface DemoCommit {
    oid: string
    parents: string[]
    message: string
    author: string
    timestamp: number
    files: Record<string, string>
}

export interface DemoIssue extends Issue {
    comments: IssueComment[]
}

export interface DemoRepo {
    dir: string
    name: string
    note: string
    commits: Record<string, DemoCommit>
    branches: Record<string, string>
    current: string
    work: Record<string, Record<string, string>>
    tags: Record<string, string>
    kinds: EventKind[]
    events: DueEvent[]
    issues: DemoIssue[]
    branchIssues: Record<string, number[]>
    reviews: ReviewEvent[]
    deliveries: DeliveryRecord[]
}

export interface DemoState {
    version: number
    repos: DemoRepo[]
    settings: AppSettings
}

export const newOid = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('')
export const newId = () => newOid().slice(0, 16)
export const effectiveTag = (docPath: string, date: string) => `施行/${docPath.replace(/\.md$/i, '')}/${date}`
export const branchLabel = (name: string) => (name === MAIN ? '現行版' : name.startsWith(DRAFT_PREFIX) ? name.slice(DRAFT_PREFIX.length) : name)

export function draftRef(label: string): string {
    const slug = label
        .trim()
        .replace(/[\s~^:?*[\]\\/]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
    if (!slug) throw new Error('改定案の名前を入力してください')
    return DRAFT_PREFIX + slug
}

export function ancestors(repo: DemoRepo, oid: string): Set<string> {
    const seen = new Set<string>()
    const stack = [oid]
    while (stack.length) {
        const o = stack.pop()!
        if (seen.has(o) || !repo.commits[o]) continue
        seen.add(o)
        stack.push(...repo.commits[o].parents)
    }
    return seen
}

export function firstParentLine(repo: DemoRepo, oid: string | undefined): string[] {
    const out: string[] = []
    let cur = oid
    while (cur && repo.commits[cur]) {
        out.push(cur)
        cur = repo.commits[cur].parents[0]
    }
    return out
}

export const headOf = (repo: DemoRepo, branch = repo.current) => repo.commits[repo.branches[branch]]

export function workOf(repo: DemoRepo, branch = repo.current): Record<string, string> {
    return repo.work[branch] ?? headOf(repo, branch)?.files ?? {}
}
