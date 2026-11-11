import fs from 'node:fs'
import { createHash } from 'node:crypto'
import git from './igit'
import type { Issue, IssueComment, IssueDetail, IssueLink, IssuePatch, IssueVersion } from '../shared/api'
import { issueRefs } from '../shared/issue-refs'
import { forgeOf, type Forge } from './forge'
import { author } from './git-base'
import { newId, readRecords, RECORD, writeRecord } from './records'
import * as g from './git'

interface LocalIssue {
    id: string
    n: number
    title: string
    body: string
    state: 'open' | 'closed'
    author?: string
    createdAt: string
    closedAt?: string
    closedBy?: string
    links: IssueLink[]
    movedTo?: number
}

interface LocalComment {
    id: string
    issue: string
    body: string
    by?: string
    at: string
}

interface BranchLinks {
    branch: string
    issues: number[]
}

const MARK = '（ClauseDown）'
const firstLine = (s: string) => s.split('\n')[0].trim()
export const linkComment = (oid: string, message: string) => `版 ${oid}「${firstLine(message)}」を紐付けました${MARK}`
export const closeComment = (oid: string, message: string) => `版 ${oid}「${firstLine(message)}」で解決しました${MARK}`
const COMMENT_OID = /版 ([0-9a-f]{40})「/

function asComment(c: { id: string; body: string; by?: string; at: string }): IssueComment {
    const m = c.body.includes(MARK) ? COMMENT_OID.exec(c.body) : null
    if (!m) return { ...c, kind: 'user' }
    return { ...c, kind: c.body.includes('で解決しました') ? 'close' : 'link', oid: m[1] }
}

async function localComments(dir: string, issueId: string): Promise<LocalComment[]> {
    return (await readRecords<LocalComment>(dir, RECORD.issueComments))
        .filter((c) => c.issue === issueId && typeof c.body === 'string' && typeof c.at === 'string')
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

const pad = (v: number) => String(v).padStart(2, '0')
function movedCommentNote(c: LocalComment): string {
    const d = new Date(c.at)
    const when = Number.isNaN(d.getTime()) ? c.at : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    return `（${c.by ? `${c.by}・` : ''}${when} のコメント）`
}

const fileOf = (i: LocalIssue) => `${RECORD.issues}${i.id}.json`
const linksFile = (branch: string) => `${RECORD.issueLinks}${createHash('sha1').update(branch).digest('hex')}.json`
const now = () => new Date().toISOString()

function toIssue(i: LocalIssue): Issue {
    return {
        n: i.n,
        title: i.title,
        body: i.body,
        state: i.state,
        author: i.author,
        createdAt: i.createdAt,
        closedAt: i.closedAt,
        closedBy: i.closedBy,
        links: i.links ?? [],
        source: 'local',
    }
}

async function localAll(dir: string): Promise<LocalIssue[]> {
    const list = (await readRecords<LocalIssue>(dir, RECORD.issues)).filter((i) => typeof i.n === 'number' && typeof i.id === 'string')
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const used = new Set<number>()
    let max = Math.max(0, ...list.map((i) => i.n))
    for (const i of sorted) {
        if (used.has(i.n)) {
            const old = i.n
            i.n = ++max
            i.body = `${i.body.replace(/\s+$/, '')}\n\n（ほかの PC で作った課題と番号が重なったため、#${old} から #${i.n} に振り直しました）`
            await writeRecord(dir, fileOf(i), i)
        }
        used.add(i.n)
    }
    return sorted
}

async function localActive(dir: string): Promise<LocalIssue[]> {
    return (await localAll(dir)).filter((i) => i.movedTo === undefined)
}

async function findLocal(dir: string, n: number): Promise<LocalIssue> {
    const i = (await localActive(dir)).find((x) => x.n === n)
    if (!i) throw new Error(`課題 #${n} が見つかりません`)
    return i
}

async function commitMessage(dir: string, oid: string): Promise<string> {
    if (typeof oid !== 'string' || !/^[0-9a-f]{40}$/.test(oid)) throw new Error('版の指定が正しくありません')
    const { commit } = await git.readCommit({ fs, dir, oid }).catch(() => {
        throw new Error('指定した版が見つかりません')
    })
    return commit.message
}

const cleanText = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n').slice(0, max) : '')

export async function listIssues(dir: string): Promise<Issue[]> {
    const forge = await forgeOf(dir)
    const list = forge ? await forge.listIssues() : (await localActive(dir)).map(toIssue)
    return list.sort((a, b) => b.n - a.n)
}

export async function createIssue(dir: string, input: { title?: unknown; body?: unknown }): Promise<Issue> {
    const title = cleanText(input?.title, 300).trim()
    if (!title) throw new Error('課題の題名を入力してください')
    const body = cleanText(input?.body, 60_000)
    const forge = await forgeOf(dir)
    if (forge) return forge.createIssue(title, body)
    const all = await localAll(dir)
    const issue: LocalIssue = {
        id: newId(),
        n: Math.max(0, ...all.map((i) => i.n)) + 1,
        title,
        body,
        state: 'open',
        author: (await author(dir).catch(() => null))?.name,
        createdAt: now(),
        links: [],
    }
    await writeRecord(dir, fileOf(issue), issue)
    return toIssue(issue)
}

export async function updateIssue(dir: string, n: number, patch: IssuePatch): Promise<Issue> {
    const clean: IssuePatch = {}
    if (patch?.title !== undefined) {
        clean.title = cleanText(patch.title, 300).trim()
        if (!clean.title) throw new Error('課題の題名を入力してください')
    }
    if (patch?.body !== undefined) clean.body = cleanText(patch.body, 60_000)
    if (patch?.state === 'open' || patch?.state === 'closed') clean.state = patch.state
    const forge = await forgeOf(dir)
    if (forge) return forge.updateIssue(n, clean)
    const i = await findLocal(dir, n)
    Object.assign(i, clean)
    if (clean.state === 'closed' && !i.closedAt) i.closedAt = now()
    if (clean.state === 'open') {
        delete i.closedAt
        delete i.closedBy
    }
    await writeRecord(dir, fileOf(i), i)
    return toIssue(i)
}

export async function linkIssue(dir: string, n: number, oid: string): Promise<void> {
    const message = await commitMessage(dir, oid)
    const forge = await forgeOf(dir)
    if (forge) return forge.comment(n, linkComment(oid, message))
    const i = await findLocal(dir, n)
    if ((i.links ?? []).some((l) => l.oid === oid)) return
    i.links = [...(i.links ?? []), { oid, at: now(), by: (await author(dir).catch(() => null))?.name }]
    await writeRecord(dir, fileOf(i), i)
}

export async function closeIssue(dir: string, n: number, oid?: string): Promise<Issue> {
    const message = oid ? await commitMessage(dir, oid) : ''
    const forge = await forgeOf(dir)
    if (forge) {
        if (oid) await forge.comment(n, closeComment(oid, message))
        return forge.updateIssue(n, { state: 'closed' })
    }
    const i = await findLocal(dir, n)
    i.state = 'closed'
    i.closedAt = now()
    if (oid) i.closedBy = oid
    await writeRecord(dir, fileOf(i), i)
    return toIssue(i)
}

export async function commentIssue(dir: string, n: number, body: unknown): Promise<void> {
    const text = cleanText(body, 60_000)
    if (!text.trim()) throw new Error('コメントを書いてください')
    const forge = await forgeOf(dir)
    if (forge) return forge.comment(n, text)
    const issue = await findLocal(dir, n)
    const c: LocalComment = { id: newId(), issue: issue.id, body: text, by: (await author(dir).catch(() => null))?.name, at: now() }
    await writeRecord(dir, `${RECORD.issueComments}${c.id}.json`, c)
}

export async function issueDetail(dir: string, n: number): Promise<IssueDetail> {
    const forge = await forgeOf(dir)
    const local = forge ? null : await findLocal(dir, n)
    const issue = forge ? (await forge.listIssues()).find((i) => i.n === n) : toIssue(local!)
    if (!issue) throw new Error(`課題 #${n} が見つかりません`)
    const comments: IssueComment[] = forge
        ? (await forge.comments(n).catch(() => [])).map(asComment)
        : (await localComments(dir, local!.id)).map((c) => ({ id: c.id, body: c.body, by: c.by, at: c.at, kind: 'user' as const }))
    const how = new Map<string, IssueVersion['how']>()
    const rank = { ref: 0, link: 1, close: 2 } as const
    const put = (oid: string, h: IssueVersion['how']) => {
        const cur = how.get(oid)
        if (!cur || rank[h] > rank[cur]) how.set(oid, h)
    }
    for (const l of issue.links) put(l.oid, 'link')
    if (issue.closedBy) put(issue.closedBy, 'close')
    for (const c of comments) if (c.oid) put(c.oid, c.kind === 'close' ? 'close' : 'link')
    const commits = await g.log(dir, undefined, true).catch(() => [])
    for (const c of commits) {
        const r = issueRefs(c.message)
        if (r.closes.includes(n)) put(c.oid, 'close')
        else if (r.refs.includes(n)) put(c.oid, 'ref')
    }
    const byOid = new Map(commits.map((c) => [c.oid, c]))
    const versions: IssueVersion[] = []
    for (const [oid, h] of how) {
        const c = byOid.get(oid)
        const message = c?.message ?? (await commitMessage(dir, oid).catch(() => ''))
        versions.push({ oid, message, at: c?.timestamp ?? 0, how: h })
    }
    versions.sort((a, b) => b.at - a.at)
    const drafts = (await readRecords<BranchLinks>(dir, RECORD.issueLinks)).filter((b) => b.issues?.includes(n)).map((b) => b.branch)
    return { ...issue, versions, drafts, comments }
}

export async function branchIssues(dir: string, branch: string): Promise<number[]> {
    const rec = (await readRecords<BranchLinks>(dir, RECORD.issueLinks)).find((b) => b.branch === branch)
    return rec?.issues ?? []
}

export async function setBranchIssues(dir: string, branch: string, issues: number[]): Promise<void> {
    if (typeof branch !== 'string' || !branch) throw new Error('改定案を指定してください')
    const clean = [...new Set((Array.isArray(issues) ? issues : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
    await writeRecord(dir, linksFile(branch), { branch, issues: clean } satisfies BranchLinks)
}

export async function reviewBodyLines(dir: string, branch: string): Promise<string> {
    const issues = await branchIssues(dir, branch)
    return issues.map((n) => `Closes #${n}`).join('\n')
}

export async function newOnMain(dir: string, before: string | null, after: string): Promise<{ oid: string; message: string }[]> {
    const seen = new Set<string>()
    if (before) for (const c of await git.log({ fs, dir, ref: before, depth: 2000 })) seen.add(c.oid)
    return (await git.log({ fs, dir, ref: after, depth: 2000 })).filter((c) => !seen.has(c.oid)).map((c) => ({ oid: c.oid, message: c.commit.message }))
}

async function closeOnForge(forge: Forge, n: number, oid: string, message: string) {
    const issue = (await forge.listIssues()).find((i) => i.n === n)
    if (!issue || issue.state === 'closed') return
    await forge.comment(n, closeComment(oid, message))
    await forge.updateIssue(n, { state: 'closed' })
}

export async function afterMain(dir: string, commits: { oid: string; message: string }[], branch?: string): Promise<number[]> {
    const linked = branch ? await branchIssues(dir, branch) : []
    const head = commits[0]
    const forge = await forgeOf(dir)
    const closed: number[] = []
    if (forge) {
        if (!head) return closed
        for (const n of linked) {
            await closeOnForge(forge, n, head.oid, head.message).catch(() => { })
            closed.push(n)
        }
        return closed
    }
    const targets = new Map<number, string>()
    for (const c of [...commits].reverse()) for (const n of issueRefs(c.message).closes) if (!targets.has(n)) targets.set(n, c.oid)
    if (head) for (const n of linked) if (!targets.has(n)) targets.set(n, head.oid)
    const open = new Map((await localActive(dir)).filter((i) => i.state === 'open').map((i) => [i.n, i]))
    for (const [n, oid] of targets) {
        const i = open.get(n)
        if (!i) continue
        i.state = 'closed'
        i.closedAt = now()
        i.closedBy = oid
        await writeRecord(dir, fileOf(i), i)
        closed.push(n)
    }
    return closed
}

export async function afterSave(dir: string, oid: string): Promise<number[]> {
    const main = await g.mainBranch(dir)
    if ((await git.currentBranch({ fs, dir })) !== main) return []
    return afterMain(dir, [{ oid, message: await commitMessage(dir, oid) }])
}

export async function pendingLocalIssues(dir: string): Promise<number> {
    if (!(await forgeOf(dir))) return 0
    return (await localActive(dir)).length
}

export async function moveIssuesToForge(dir: string): Promise<{ moved: number; renumbered: { from: number; to: number }[] }> {
    const forge = await forgeOf(dir)
    if (!forge) throw new Error('GitHub・GitLab に接続していないため、課題を移せません')
    const local = (await localActive(dir)).sort((a, b) => a.n - b.n)
    const renumbered: { from: number; to: number }[] = []
    for (const i of local) {
        let created = await forge.createIssue(i.title, i.body)
        if (created.n !== i.n) {
            renumbered.push({ from: i.n, to: created.n })
            created = await forge.updateIssue(created.n, { body: `${i.body.replace(/\s+$/, '')}\n\n（ClauseDown での旧番号 #${i.n}）` })
        }
        for (const l of i.links ?? []) await forge.comment(created.n, linkComment(l.oid, await commitMessage(dir, l.oid).catch(() => ''))).catch(() => { })
        for (const c of await localComments(dir, i.id)) await forge.comment(created.n, `${movedCommentNote(c)}\n\n${c.body}`)
        if (i.state === 'closed') {
            if (i.closedBy) await forge.comment(created.n, closeComment(i.closedBy, await commitMessage(dir, i.closedBy).catch(() => ''))).catch(() => { })
            await forge.updateIssue(created.n, { state: 'closed' })
        }
        i.movedTo = created.n
        await writeRecord(dir, fileOf(i), i)
    }
    return { moved: local.length, renumbered }
}
