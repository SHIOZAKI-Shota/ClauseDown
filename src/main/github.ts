import { getToken } from './settings'

export interface GitHubRepo {
    owner: string
    repo: string
}

export function parseGitHub(url: string | null | undefined): GitHubRepo | null {
    if (!url) return null
    const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim())
    return m ? { owner: m[1], repo: m[2] } : null
}

const apiBase = () => process.env.CLAUSEDOWN_GITHUB_API ?? 'https://api.github.com'

export class GitHubError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message)
    }
}

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await getToken()
    if (!token) throw new Error('設定画面でアクセストークンを入力してください')
    const res = await fetch(url.startsWith('http') ? url : apiBase() + url, {
        method,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
        },
        body: body === undefined ? undefined : body instanceof Uint8Array ? new Blob([body as Uint8Array<ArrayBuffer>]) : JSON.stringify(body),
    })
    if (!res.ok) {
        let msg = res.statusText
        try {
            const j = (await res.json()) as { message?: string; errors?: { message?: string }[] }
            msg = [j.message, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join(' / ')
        } catch {
        }
        const issueHint = res.status === 403 && /\/issues(\/|\?|$)/.test(url) ? '。課題を使うには、GitHub App の権限に「Issues: Read and write」が必要です（App の持ち主が設定し、インストール先で承認します）' : ''
        throw new GitHubError(res.status, githubMessage(res.status, msg) + issueHint)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
}

function githubMessage(status: number, msg: string): string {
    if (status === 401) return 'GitHub のアクセストークンが正しくありません'
    if (status === 403) return `GitHub の権限が足りません（${msg}）`
    if (/Can not approve your own pull request/i.test(msg)) return '自分が依頼した改定案は、GitHub では承認できません'
    if (status === 405 && /protected|review/i.test(msg)) return `GitHub の設定により、まだ反映できません（${msg}）`
    return `GitHub：${msg}`
}

const enc = encodeURIComponent
const repoPath = (r: GitHubRepo) => `/repos/${enc(r.owner)}/${enc(r.repo)}`

export interface PullRequest {
    number: number
    html_url: string
    state: 'open' | 'closed'
    merged?: boolean
    mergeable?: boolean | null
    head: { ref: string; sha: string }
    user?: { login: string }
}

export interface Review {
    id: number
    user: { login: string } | null
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
    body: string
    commit_id: string
    submitted_at: string
}

export async function findOpenPull(r: GitHubRepo, head: string): Promise<PullRequest | null> {
    const list = await call<PullRequest[]>('GET', `${repoPath(r)}/pulls?state=open&head=${enc(`${r.owner}:${head}`)}`)
    return list[0] ?? null
}

export function createPull(r: GitHubRepo, head: string, base: string, title: string, body: string) {
    return call<PullRequest>('POST', `${repoPath(r)}/pulls`, { head, base, title, body })
}

export function getPull(r: GitHubRepo, n: number) {
    return call<PullRequest>('GET', `${repoPath(r)}/pulls/${n}`)
}

export function closePull(r: GitHubRepo, n: number) {
    return call<PullRequest>('PATCH', `${repoPath(r)}/pulls/${n}`, { state: 'closed' })
}

export function listReviews(r: GitHubRepo, n: number) {
    return call<Review[]>('GET', `${repoPath(r)}/pulls/${n}/reviews?per_page=100`)
}

export function createReview(r: GitHubRepo, n: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, commitId?: string) {
    return call<Review>('POST', `${repoPath(r)}/pulls/${n}/reviews`, { event, body, commit_id: commitId })
}

export function mergePull(r: GitHubRepo, n: number, title: string, sha?: string) {
    return call<{ merged: boolean; sha: string }>('PUT', `${repoPath(r)}/pulls/${n}/merge`, {
        merge_method: 'merge',
        commit_title: title,
        sha,
    })
}

export interface Release {
    id: number
    html_url: string
    upload_url: string
}

export function createRelease(r: GitHubRepo, tag: string, name: string, body: string) {
    return call<Release>('POST', `${repoPath(r)}/releases`, { tag_name: tag, name, body })
}

export function uploadAsset(release: Release, name: string, data: Uint8Array, contentType: string) {
    const url = release.upload_url.replace(/\{\?[^}]*\}$/, '') + `?name=${enc(name)}`
    return call<{ browser_download_url: string }>('POST', url, data, { 'Content-Type': contentType })
}

export interface RepoInfo {
    full_name: string
    clone_url: string
    html_url: string
}

export function forkRepo(r: GitHubRepo) {
    return call<RepoInfo>('POST', `${repoPath(r)}/forks`, { default_branch_only: false })
}

export function getRepo(fullName: string) {
    const [owner, repo] = fullName.split('/')
    return call<RepoInfo>('GET', repoPath({ owner, repo }))
}

export interface GitHubIssue {
    number: number
    title: string
    body: string | null
    state: 'open' | 'closed'
    user?: { login: string }
    created_at: string
    closed_at: string | null
    html_url: string
    pull_request?: unknown
}

export async function listIssues(r: GitHubRepo): Promise<GitHubIssue[]> {
    const out: GitHubIssue[] = []
    for (let page = 1; page <= 10; page++) {
        const list = await call<GitHubIssue[]>('GET', `${repoPath(r)}/issues?state=all&per_page=100&page=${page}`)
        out.push(...list.filter((i) => !i.pull_request))
        if (list.length < 100) break
    }
    return out
}

export function createIssue(r: GitHubRepo, title: string, body: string) {
    return call<GitHubIssue>('POST', `${repoPath(r)}/issues`, { title, body })
}

export function updateIssue(r: GitHubRepo, n: number, patch: { title?: string; body?: string; state?: 'open' | 'closed' }) {
    return call<GitHubIssue>('PATCH', `${repoPath(r)}/issues/${n}`, patch)
}

export function commentIssue(r: GitHubRepo, n: number, body: string) {
    return call<unknown>('POST', `${repoPath(r)}/issues/${n}/comments`, { body })
}

export async function issueComments(r: GitHubRepo, n: number): Promise<{ id: number; body: string; user?: { login: string }; created_at: string }[]> {
    const out: { id: number; body: string; user?: { login: string }; created_at: string }[] = []
    for (let page = 1; page <= 20; page++) {
        const list = await call<typeof out>('GET', `${repoPath(r)}/issues/${n}/comments?per_page=100&page=${page}`)
        out.push(...list)
        if (list.length < 100) break
    }
    return out
}
