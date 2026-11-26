import { ForgeHttpError, githubApi, paginate, prNumber } from './forge-http'
import type { IssueState } from '../shared/forge'
import { t } from '../shared/i18n'
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

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
	const token = await getToken()
	if (!token) throw new Error(t().errors.github.tokenRequired)
	const res = await fetch(url.startsWith('http') ? url : githubApi() + url, {
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
		} catch {}
		const issueHint = res.status === 403 && /\/issues(\/|\?|$)/.test(url) ? t().errors.github.issuesPermission : ''
		throw new ForgeHttpError(res.status, githubMessage(res.status, msg) + issueHint)
	}
	if (res.status === 204) return undefined as T
	return (await res.json()) as T
}

function githubMessage(status: number, msg: string): string {
	if (status === 401) return t().errors.github.badToken
	if (status === 403) return t().errors.github.forbidden(msg)
	if (/Can not approve your own pull request/i.test(msg)) return t().errors.github.ownPr
	if (status === 405 && /protected|review/i.test(msg)) return t().errors.github.notMergeable(msg)
	return `GitHub：${msg}`
}

const enc = encodeURIComponent
const repoPath = (r: GitHubRepo) => `/repos/${enc(r.owner)}/${enc(r.repo)}`

export interface PullRequest {
	number: number
	html_url: string
	state: IssueState
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
	return call<PullRequest>('GET', `${repoPath(r)}/pulls/${prNumber(n)}`)
}

export function closePull(r: GitHubRepo, n: number) {
	return call<PullRequest>('PATCH', `${repoPath(r)}/pulls/${prNumber(n)}`, { state: 'closed' })
}

export function listReviews(r: GitHubRepo, n: number) {
	return call<Review[]>('GET', `${repoPath(r)}/pulls/${prNumber(n)}/reviews?per_page=100`)
}

export function createReview(r: GitHubRepo, n: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string, commitId?: string) {
	return call<Review>('POST', `${repoPath(r)}/pulls/${prNumber(n)}/reviews`, { event, body, commit_id: commitId })
}

export function mergePull(r: GitHubRepo, n: number, title: string, sha?: string) {
	return call<{ merged: boolean; sha: string }>('PUT', `${repoPath(r)}/pulls/${prNumber(n)}/merge`, {
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
	state: IssueState
	user?: { login: string }
	created_at: string
	closed_at: string | null
	html_url: string
	pull_request?: unknown
}

export async function listIssues(r: GitHubRepo): Promise<GitHubIssue[]> {
	const all = await paginate((page) => call<GitHubIssue[]>('GET', `${repoPath(r)}/issues?state=all&per_page=100&page=${page}`), 10)
	return all.filter((i) => !i.pull_request)
}

export function createIssue(r: GitHubRepo, title: string, body: string) {
	return call<GitHubIssue>('POST', `${repoPath(r)}/issues`, { title, body })
}

export function updateIssue(r: GitHubRepo, n: number, patch: { title?: string; body?: string; state?: IssueState }) {
	return call<GitHubIssue>('PATCH', `${repoPath(r)}/issues/${prNumber(n)}`, patch)
}

export function commentIssue(r: GitHubRepo, n: number, body: string) {
	return call<unknown>('POST', `${repoPath(r)}/issues/${prNumber(n)}/comments`, { body })
}

export async function issueComments(r: GitHubRepo, n: number): Promise<{ id: number; body: string; user?: { login: string }; created_at: string }[]> {
	return paginate(
		(page) =>
			call<{ id: number; body: string; user?: { login: string }; created_at: string }[]>(
				'GET',
				`${repoPath(r)}/issues/${prNumber(n)}/comments?per_page=100&page=${page}`,
			),
		20,
	)
}

export async function addSigningKey(title: string, key: string): Promise<void> {
	await call('POST', '/user/ssh_signing_keys', { title, key })
}

export async function signingKeysOf(login: string): Promise<string[]> {
	const keys = await call<{ key: string }[]>('GET', `/users/${encodeURIComponent(login)}/ssh_signing_keys`)
	return keys.map((k) => k.key)
}
