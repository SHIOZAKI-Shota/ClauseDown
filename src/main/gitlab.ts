import { gitlabApi } from './gitlab-auth'
import { getToken } from './settings'

export interface GitLabRepo {
    base: string
    path: string
}

export class GitLabError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message)
    }
}

async function call<T>(r: GitLabRepo, method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const token = await getToken(r.base)
    if (!token) throw new Error('GitLab にログインしていません。設定の「GitHub/GitLab」でログインしてください')
    const res = await fetch(gitlabApi(r.base) + path, {
        method,
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    if (!res.ok) {
        let msg = res.statusText
        try {
            const j = (await res.json()) as { message?: unknown; error?: unknown }
            const m = j.message ?? j.error
            if (m) msg = typeof m === 'string' ? m : JSON.stringify(m)
        } catch {
        }
        throw new GitLabError(res.status, gitlabMessage(res.status, msg))
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
}

function gitlabMessage(status: number, msg: string): string {
    if (status === 401) return `GitLab のログインの期限が切れたか、アクセストークンが正しくありません（${msg}）`
    if (status === 403) return `GitLab の権限が足りません。このプロジェクトで「Developer」以上の役割が必要です（${msg}）`
    if (status === 404) return `GitLab でプロジェクトまたはマージリクエストが見つかりません（${msg}）`
    return `GitLab：${msg}`
}

const enc = encodeURIComponent
const proj = (r: GitLabRepo) => `/projects/${enc(r.path)}`

export interface MergeRequest {
    iid: number
    web_url: string
    state: 'opened' | 'closed' | 'merged' | 'locked'
    sha: string
    author?: { username: string }
    detailed_merge_status?: string
    merge_commit_sha?: string | null
    squash_commit_sha?: string | null
}

export interface Note {
    id: number
    body: string
    system: boolean
    author: { username: string }
    created_at: string
}

export interface MrVersion {
    id: number
    head_commit_sha: string
    created_at: string
}

export async function findOpenMr(r: GitLabRepo, source: string, target: string): Promise<MergeRequest | null> {
    const list = await call<MergeRequest[]>(
        r,
        'GET',
        `${proj(r)}/merge_requests?state=opened&source_branch=${enc(source)}&target_branch=${enc(target)}`,
    )
    return list[0] ?? null
}

export function createMr(r: GitLabRepo, source: string, target: string, title: string, description: string) {
    return call<MergeRequest>(r, 'POST', `${proj(r)}/merge_requests`, {
        source_branch: source,
        target_branch: target,
        title,
        description,
        remove_source_branch: false,
    })
}

export function getMr(r: GitLabRepo, iid: number) {
    return call<MergeRequest>(r, 'GET', `${proj(r)}/merge_requests/${iid}`)
}

export function closeMr(r: GitLabRepo, iid: number) {
    return call<MergeRequest>(r, 'PUT', `${proj(r)}/merge_requests/${iid}`, { state_event: 'close' })
}

export async function listApprovals(r: GitLabRepo, iid: number): Promise<string[]> {
    const j = await call<{ approved_by?: { user?: { username?: string } }[] }>(r, 'GET', `${proj(r)}/merge_requests/${iid}/approvals`)
    return (j.approved_by ?? []).map((a) => a.user?.username).filter((u): u is string => !!u)
}

export function approve(r: GitLabRepo, iid: number, sha?: string) {
    return call<unknown>(r, 'POST', `${proj(r)}/merge_requests/${iid}/approve`, sha ? { sha } : {})
}

export function unapprove(r: GitLabRepo, iid: number) {
    return call<unknown>(r, 'POST', `${proj(r)}/merge_requests/${iid}/unapprove`, {})
}

export async function listNotes(r: GitLabRepo, iid: number): Promise<Note[]> {
    const out: Note[] = []
    for (let page = 1; page <= 20; page++) {
        const list = await call<Note[]>(
            r,
            'GET',
            `${proj(r)}/merge_requests/${iid}/notes?sort=asc&order_by=created_at&per_page=100&page=${page}`,
        )
        out.push(...list)
        if (list.length < 100) break
    }
    return out
}

export function addNote(r: GitLabRepo, iid: number, body: string) {
    return call<Note>(r, 'POST', `${proj(r)}/merge_requests/${iid}/notes`, { body })
}

export function listVersions(r: GitLabRepo, iid: number) {
    return call<MrVersion[]>(r, 'GET', `${proj(r)}/merge_requests/${iid}/versions?per_page=100`)
}

export async function mergeMr(r: GitLabRepo, iid: number, message: string, sha: string): Promise<string> {
    let mr = await getMr(r, iid)
    for (let i = 0; i < 15 && ['checking', 'unchecked', 'preparing', 'approvals_syncing'].includes(mr.detailed_merge_status ?? ''); i++) {
        await new Promise((res) => setTimeout(res, Number(process.env.CLAUSEDOWN_GITLAB_WAIT_MS ?? 1000)))
        mr = await getMr(r, iid)
    }
    try {
        const done = await call<MergeRequest>(r, 'PUT', `${proj(r)}/merge_requests/${iid}/merge`, {
            merge_commit_message: message,
            sha,
            should_remove_source_branch: false,
        })
        return done.merge_commit_sha ?? done.squash_commit_sha ?? sha
    } catch (e) {
        if (!(e instanceof GitLabError)) throw e
        if (e.status === 409) throw new Error('GitLab 側の改定案が、ローカル の改定案と違っています。同期してからもう一度反映してください')
        if (e.status === 405 || e.status === 406 || e.status === 422) {
            throw new Error(`GitLab の設定により、まだ反映できません（承認の数や、パイプラインの結果を確かめてください）。${e.message}`)
        }
        throw e
    }
}

export interface ReleaseLink {
    url: string
}

export function createRelease(r: GitLabRepo, tag: string, name: string, description: string) {
    return call<{ _links?: { self?: string } }>(r, 'POST', `${proj(r)}/releases`, { tag_name: tag, name, description })
}

export async function uploadFile(r: GitLabRepo, name: string, data: Uint8Array, type: string): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([data as Uint8Array<ArrayBuffer>], { type }), name)
    const j = await call<{ url: string; full_path?: string }>(r, 'POST', `${proj(r)}/uploads`, undefined, form)
    return j.full_path?.startsWith('/') ? r.base + j.full_path : `${r.base}/${r.path}${j.url}`
}

export function addReleaseLink(r: GitLabRepo, tag: string, name: string, url: string) {
    return call<unknown>(r, 'POST', `${proj(r)}/releases/${enc(tag)}/assets/links`, { name, url, link_type: 'other' })
}

export const releaseWebUrl = (r: GitLabRepo, tag: string) => `${r.base}/${r.path}/-/releases/${enc(tag)}`

export interface Project {
    id: number
    http_url_to_repo: string
    web_url: string
    import_status?: string
}

export function forkProject(r: GitLabRepo) {
    return call<Project>(r, 'POST', `${proj(r)}/fork`, {})
}

export function getProject(r: GitLabRepo, id: number) {
    return call<Project>(r, 'GET', `/projects/${id}`)
}

export interface GitLabIssue {
    iid: number
    title: string
    description: string | null
    state: 'opened' | 'closed'
    author?: { username: string }
    created_at: string
    closed_at: string | null
    web_url: string
}

export async function listIssues(r: GitLabRepo): Promise<GitLabIssue[]> {
    const out: GitLabIssue[] = []
    for (let page = 1; page <= 10; page++) {
        const list = await call<GitLabIssue[]>(r, 'GET', `${proj(r)}/issues?scope=all&per_page=100&page=${page}`)
        out.push(...list)
        if (list.length < 100) break
    }
    return out
}

export function createIssue(r: GitLabRepo, title: string, description: string) {
    return call<GitLabIssue>(r, 'POST', `${proj(r)}/issues`, { title, description })
}

export function updateIssue(r: GitLabRepo, iid: number, patch: { title?: string; body?: string; state?: 'open' | 'closed' }) {
    return call<GitLabIssue>(r, 'PUT', `${proj(r)}/issues/${iid}`, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { description: patch.body } : {}),
        ...(patch.state ? { state_event: patch.state === 'closed' ? 'close' : 'reopen' } : {}),
    })
}

export function commentIssue(r: GitLabRepo, iid: number, body: string) {
    return call<unknown>(r, 'POST', `${proj(r)}/issues/${iid}/notes`, { body })
}

export async function issueComments(r: GitLabRepo, iid: number): Promise<{ id: number; body: string; system?: boolean; author?: { username: string }; created_at: string }[]> {
    const out: { id: number; body: string; system?: boolean; author?: { username: string }; created_at: string }[] = []
    for (let page = 1; page <= 20; page++) {
        const list = await call<typeof out>(r, 'GET', `${proj(r)}/issues/${iid}/notes?per_page=100&sort=asc&order_by=created_at&page=${page}`)
        out.push(...list)
        if (list.length < 100) break
    }
    return out
}
