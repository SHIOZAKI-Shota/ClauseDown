import { GITHUB_BASE, knownBases, matchRemote, type ForgeKind } from '../shared/forge'
import type { ReviewAction, ReviewEvent } from '../shared/review'
import type { Issue, IssuePatch } from '../shared/api'
import { remoteUrl } from './git-base'
import * as gh from './github'
import * as gl from './gitlab'
import { loadCredential, loadSettings } from './settings'

export interface ReleaseFile {
    name: string
    data: Uint8Array
    type: string
}

export interface Forge {
    kind: ForgeKind
    base: string
    openReview(branch: string, target: string, title: string, body: string): Promise<{ n: number; author?: string }>
    closeReview(n: number): Promise<void>
    decisions(request: ReviewEvent): Promise<ReviewEvent[]>
    submit(n: number, action: Exclude<ReviewAction, 'request' | 'withdraw'>, text: string | null, oid: string): Promise<void>
    merge(n: number, message: string, sha: string): Promise<string>
    release(tag: string, name: string, body: string, files: ReleaseFile[]): Promise<string>
    listIssues(): Promise<Issue[]>
    createIssue(title: string, body: string): Promise<Issue>
    updateIssue(n: number, patch: IssuePatch): Promise<Issue>
    comment(n: number, body: string): Promise<void>
    comments(n: number): Promise<{ id: string; body: string; by?: string; at: string }[]>
}

const fromGitHub = (i: gh.GitHubIssue): Issue => ({
    n: i.number,
    title: i.title,
    body: i.body ?? '',
    state: i.state,
    author: i.user?.login,
    createdAt: i.created_at,
    closedAt: i.closed_at ?? undefined,
    url: i.html_url,
    links: [],
    source: 'github',
})

const fromGitLab = (i: gl.GitLabIssue): Issue => ({
    n: i.iid,
    title: i.title,
    body: i.description ?? '',
    state: i.state === 'closed' ? 'closed' : 'open',
    author: i.author?.username,
    createdAt: i.created_at,
    closedAt: i.closed_at ?? undefined,
    url: i.web_url,
    links: [],
    source: 'gitlab',
})

export async function forgeOf(dir: string): Promise<Forge | null> {
    if (process.env.CLAUSEDOWN_GITHUB_REPO) return githubForge(process.env.CLAUSEDOWN_GITHUB_REPO)
    if (process.env.CLAUSEDOWN_GITLAB_REPO) {
        const [base, path] = process.env.CLAUSEDOWN_GITLAB_REPO.split('|')
        return gitlabForge({ base, path })
    }
    const m = matchRemote(await remoteUrl(dir), knownBases(await loadSettings()))
    if (!m) return null
    return m.kind === 'github' ? githubForge(m.path) : gitlabForge({ base: m.base, path: m.path })
}

export async function forgeKind(dir: string): Promise<ForgeKind | null> {
    return (await forgeOf(dir))?.kind ?? null
}

function githubForge(path: string): Forge {
    const [owner, repo] = path.split('/')
    const r = { owner, repo }
    return {
        kind: 'github',
        base: GITHUB_BASE,
        async openReview(branch, target, title, body) {
            const pr = (await gh.findOpenPull(r, branch)) ?? (await gh.createPull(r, branch, target, title, body))
            return { n: pr.number, author: pr.user?.login }
        },
        async closeReview(n) {
            await gh.closePull(r, n)
        },
        async decisions(req) {
            const n = req.pr ?? req.githubPr!
            const out: ReviewEvent[] = []
            for (const v of await gh.listReviews(r, n)) {
                const action: ReviewAction | null =
                    v.state === 'APPROVED' ? 'approve' : v.state === 'CHANGES_REQUESTED' ? 'changes' : v.state === 'COMMENTED' ? 'comment' : null
                if (!action || !v.submitted_at) continue
                out.push({
                    id: `gh-${v.id}`,
                    branch: req.branch,
                    action,
                    oid: v.commit_id,
                    by: v.user?.login ?? '（不明）',
                    at: v.submitted_at,
                    text: v.body ?? '',
                    source: 'github',
                    githubPr: n,
                    pr: n,
                    forge: 'github',
                })
            }
            return out
        },
        async submit(n, action, text, oid) {
            const event = action === 'approve' ? 'APPROVE' : action === 'changes' ? 'REQUEST_CHANGES' : 'COMMENT'
            await gh.createReview(r, n, event, text ?? '', oid)
        },
        async merge(n, message, sha) {
            return (await gh.mergePull(r, n, message, sha)).sha
        },
        async release(tag, name, body, files) {
            const rel = await gh.createRelease(r, tag, name, body)
            for (const f of files) await gh.uploadAsset(rel, f.name, f.data, f.type)
            return rel.html_url
        },
        listIssues: async () => (await gh.listIssues(r)).map(fromGitHub),
        createIssue: async (title, body) => fromGitHub(await gh.createIssue(r, title, body)),
        updateIssue: async (n, patch) => fromGitHub(await gh.updateIssue(r, n, patch)),
        async comment(n, body) {
            await gh.commentIssue(r, n, body)
        },
        comments: async (n) => (await gh.issueComments(r, n)).map((c) => ({ id: String(c.id), body: c.body, by: c.user?.login, at: c.created_at })),
    }
}

// GitLabには「修正を依頼」がないのでコメント
const CHANGES_MARK = '**修正依頼**'
const APPROVED_NOTE = /^approved this merge request/i

function gitlabForge(r: gl.GitLabRepo): Forge {
    return {
        kind: 'gitlab',
        base: r.base,
        async openReview(branch, target, title, body) {
            const mr = (await gl.findOpenMr(r, branch, target)) ?? (await gl.createMr(r, branch, target, title, body))
            return { n: mr.iid, author: mr.author?.username }
        },
        async closeReview(n) {
            await gl.closeMr(r, n)
        },
        async decisions(req) {
            const n = req.pr!
            const [approvers, notes, versions] = await Promise.all([gl.listApprovals(r, n), gl.listNotes(r, n), gl.listVersions(r, n)])
            const time = (s: string) => Date.parse(s) || 0
            const shaAt = (at: string) =>
                versions
                    .filter((v) => time(v.created_at) <= time(at))
                    .sort((a, b) => time(b.created_at) - time(a.created_at))[0]?.head_commit_sha ?? ''
            const base = { branch: req.branch, source: 'gitlab' as const, pr: n, forge: 'gitlab' as const }
            const out: ReviewEvent[] = []
            for (const user of approvers) {
                const note = [...notes].reverse().find((x) => x.system && x.author.username === user && APPROVED_NOTE.test(x.body))
                out.push({
                    ...base,
                    id: `gl-approve-${n}-${user}`,
                    action: 'approve',
                    oid: note ? shaAt(note.created_at) : '',
                    by: user,
                    at: note?.created_at ?? req.at,
                    text: '承認しました',
                })
            }
            for (const x of notes) {
                if (x.system) continue
                const changes = x.body.startsWith(CHANGES_MARK)
                out.push({
                    ...base,
                    id: `gl-note-${x.id}`,
                    action: changes ? 'changes' : 'comment',
                    oid: shaAt(x.created_at),
                    by: x.author.username,
                    at: x.created_at,
                    text: changes ? x.body.slice(CHANGES_MARK.length).trim() : x.body,
                })
            }
            return out
        },
        async submit(n, action, text, oid) {
            if (action === 'approve') {
                try {
                    await gl.approve(r, n, oid)
                } catch (e) {
                    const me = (await loadCredential(r.base))?.login
                    const already = me && (await gl.listApprovals(r, n).catch(() => [] as string[])).includes(me)
                    if (!already) {
                        if (e instanceof gl.GitLabError && e.status === 409) {
                            throw new Error('GitLab 側の改定案が、ローカル の改定案と違っています。同期してからもう一度承認してください')
                        }
                        throw e
                    }
                }
                if (text) await gl.addNote(r, n, text)
            } else if (action === 'changes') {
                await gl.unapprove(r, n).catch(() => { })
                await gl.addNote(r, n, `${CHANGES_MARK}\n\n${text ?? ''}`.trim())
            } else if (text) {
                await gl.addNote(r, n, text)
            }
        },
        merge: (n, message, sha) => gl.mergeMr(r, n, message, sha),
        async release(tag, name, body, files) {
            await gl.createRelease(r, tag, name, body)
            for (const f of files) await gl.addReleaseLink(r, tag, f.name, await gl.uploadFile(r, f.name, f.data, f.type))
            return gl.releaseWebUrl(r, tag)
        },
        listIssues: async () => (await gl.listIssues(r)).map(fromGitLab),
        createIssue: async (title, body) => fromGitLab(await gl.createIssue(r, title, body)),
        updateIssue: async (n, patch) => fromGitLab(await gl.updateIssue(r, n, patch)),
        async comment(n, body) {
            await gl.commentIssue(r, n, body)
        },
        comments: async (n) =>
            (await gl.issueComments(r, n)).filter((c) => !c.system).map((c) => ({ id: String(c.id), body: c.body, by: c.author?.username, at: c.created_at })),
    }
}
