import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startGitServer } from './git-server'
import { reviewStatus } from '../src/shared/review'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadCredential: async () => ({ provider: 'gitlab', method: 'app', access: 'dummy', login: state.login }),
    loadSettings: async () => ({ repos: [], author: { name: '事務員A', email: 'a@example.com' }, username: 'u' }),
    gitlabWeb: (base: string) => base,
}))
const git = await import('../src/main/git')
const wf = await import('../src/main/workflow')
const records = await import('../src/main/records')

const BASE = 'https://gitlab.example.co.jp'
let root = ''
let url = ''
let closeGit = () => { }
let api: http.Server
const state = {
    login: 'staff-a',
    mrs: [] as { iid: number; source: string; target: string; title: string; author: string; state: string; checks: number; merge_commit_sha?: string }[],
    approvals: new Map<number, Set<string>>(),
    notes: [] as { id: number; iid: number; body: string; system: boolean; author: { username: string }; created_at: string }[],
    versions: [] as { id: number; iid: number; head_commit_sha: string; created_at: string }[],
    releases: [] as { tag: string; name: string; description: string; links: { name: string; url: string }[] }[],
    uploads: [] as string[],
}

const bare = () => join(root, 'docs.git')
const headOf = (branch: string) => {
    try {
        return execFileSync('git', ['-C', bare(), 'rev-parse', `refs/heads/${branch}`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
        return ''
    }
}
function syncVersion(iid: number) {
    const mr = state.mrs.find((m) => m.iid === iid)!
    const sha = headOf(mr.source)
    const last = state.versions.filter((v) => v.iid === iid).at(-1)
    if (sha && last?.head_commit_sha !== sha) {
        state.versions.push({ id: state.versions.length + 1, iid, head_commit_sha: sha, created_at: new Date().toISOString() })
    }
    return sha
}
const note = (iid: number, body: string, system: boolean) =>
    state.notes.push({ id: state.notes.length + 1, iid, body, system, author: { username: state.login }, created_at: new Date().toISOString() })

function mergeOnServer(head: string, title: string): string {
    const work = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-gl-'))
    const g = (...args: string[]) => execFileSync('git', ['-C', work, '-c', 'user.name=GitLab', '-c', 'user.email=gl@example.com', ...args]).toString().trim()
    execFileSync('git', ['clone', '-q', bare(), work])
    g('merge', '--no-ff', '-q', '-m', title, `origin/${head}`)
    g('push', '-q', 'origin', 'HEAD:main')
    return g('rev-parse', 'HEAD')
}

beforeAll(async () => {
    ; ({ root, url, close: closeGit } = await startGitServer())
    api = http.createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const raw = Buffer.concat(chunks)
        const body = req.headers['content-type']?.includes('json') && raw.length ? JSON.parse(raw.toString()) : null
        const u = new URL(req.url!, 'http://x')
        const send = (status: number, data?: unknown) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(data === undefined ? '' : JSON.stringify(data))
        }
        const p = u.pathname
        const proj = '/projects/office%2Fsub%2Fdocs'
        if (!p.startsWith(proj)) return send(404, { message: '404 Project Not Found' })
        const rest = p.slice(proj.length)
        const toJson = (m: (typeof state.mrs)[number]) => ({
            iid: m.iid, web_url: `${BASE}/office/sub/docs/-/merge_requests/${m.iid}`, state: m.state, sha: headOf(m.source),
            author: { username: m.author }, detailed_merge_status: m.checks > 0 ? 'checking' : 'mergeable', merge_commit_sha: m.merge_commit_sha ?? null,
        })
        let m: RegExpExecArray | null
        if (rest === '/merge_requests' && req.method === 'GET') {
            const list = state.mrs.filter((x) => x.state === 'opened' && x.source === u.searchParams.get('source_branch') && x.target === u.searchParams.get('target_branch'))
            return send(200, list.map(toJson))
        }
        if (rest === '/merge_requests' && req.method === 'POST') {
            const mr = { iid: state.mrs.length + 1, source: body.source_branch, target: body.target_branch, title: body.title, author: state.login, state: 'opened', checks: 2 }
            state.mrs.push(mr)
            syncVersion(mr.iid)
            return send(201, toJson(mr))
        }
        if ((m = /^\/merge_requests\/(\d+)(\/[a-z]+)?$/.exec(rest))) {
            const iid = Number(m[1])
            const mr = state.mrs.find((x) => x.iid === iid)!
            const sub = m[2] ?? ''
            const sha = syncVersion(iid)
            const approved = state.approvals.get(iid) ?? new Set<string>()
            state.approvals.set(iid, approved)
            if (sub === '' && req.method === 'GET') {
                if (mr.checks > 0) mr.checks--
                return send(200, toJson(mr))
            }
            if (sub === '' && req.method === 'PUT') {
                if (body.state_event === 'close') mr.state = 'closed'
                return send(200, toJson(mr))
            }
            if (sub === '/approvals') return send(200, { approved_by: [...approved].map((username) => ({ user: { username } })) })
            if (sub === '/approve') {
                if (body?.sha && body.sha !== sha) return send(409, { message: 'SHA does not match HEAD of source branch' })
                if (approved.has(state.login)) return send(401, { message: '401 Unauthorized' })
                approved.add(state.login)
                note(iid, 'approved this merge request', true)
                return send(201, {})
            }
            if (sub === '/unapprove') {
                if (!approved.delete(state.login)) return send(404, { message: '404 Not Found' })
                note(iid, 'unapproved this merge request', true)
                return send(201, {})
            }
            if (sub === '/notes' && req.method === 'GET') return send(200, state.notes.filter((n) => n.iid === iid))
            if (sub === '/notes' && req.method === 'POST') {
                note(iid, body.body, false)
                return send(201, state.notes.at(-1))
            }
            if (sub === '/versions') return send(200, state.versions.filter((v) => v.iid === iid).reverse())
            if (sub === '/merge' && req.method === 'PUT') {
                if (!approved.size) return send(405, { message: '405 Method Not Allowed' })
                if (body.sha !== sha) return send(409, { message: 'SHA does not match HEAD of source branch' })
                mr.merge_commit_sha = mergeOnServer(mr.source, body.merge_commit_message)
                mr.state = 'merged'
                return send(200, toJson(mr))
            }
        }
        if (rest === '/releases' && req.method === 'POST') {
            state.releases.push({ tag: body.tag_name, name: body.name, description: body.description, links: [] })
            return send(201, { _links: { self: 'x' } })
        }
        if (rest === '/uploads' && req.method === 'POST') {
            const name = /filename="([^"]+)"/.exec(raw.toString('utf8'))?.[1] ?? '?'
            state.uploads.push(name)
            return send(201, { url: `/uploads/abc/${name}`, full_path: `/-/project/1/uploads/abc/${name}` })
        }
        if ((m = /^\/releases\/([^/]+)\/assets\/links$/.exec(rest)) && req.method === 'POST') {
            state.releases.find((r) => r.tag === decodeURIComponent(m![1]))!.links.push({ name: body.name, url: body.url })
            return send(201, {})
        }
        send(404, { message: `Not Found ${req.method} ${p}` })
    })
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()))
    process.env.CLAUSEDOWN_GITLAB_API = `http://127.0.0.1:${(api.address() as { port: number }).port}`
    process.env.CLAUSEDOWN_GITLAB_REPO = `${BASE}|office/sub/docs`
    process.env.CLAUSEDOWN_GITLAB_WAIT_MS = '5'
})
afterAll(() => {
    closeGit()
    api?.close()
    delete process.env.CLAUSEDOWN_GITLAB_API
    delete process.env.CLAUSEDOWN_GITLAB_REPO
    delete process.env.CLAUSEDOWN_GITLAB_WAIT_MS
})

const DOC = '株式会社A/就業規則.md'
const V1 = '# 就業規則\n\n### 休日\n- 日曜\n'
const remoteMain = () => execFileSync('git', ['-C', bare(), 'show', 'main:' + DOC]).toString()
const remoteRefs = () => execFileSync('git', ['-C', bare(), 'show-ref']).toString()
const RULES = { requireApproval: true, approvers: [] }

describe('GitLab 連携', () => {
    const pc = () => join(root, 'pc')
    let draft = ''
    const status = async () => reviewStatus(await wf.listReviews(pc()), draft, await git.branchOid(pc(), draft), RULES)
    const as = async <T>(login: string, fn: () => Promise<T>) => {
        state.login = login
        try {
            return await fn()
        } finally {
            state.login = 'staff-a'
        }
    }

    it('リモートの種類を GitLab と判定し、確認依頼でマージリクエストを作る', async () => {
        await git.cloneRepo(url, pc())
        await git.writeDoc(pc(), DOC, V1)
        await git.saveVersion(pc(), { message: '初版' })
        await git.push(pc())
        await wf.saveRules(pc(), RULES)
        expect(await wf.forgeKind(pc())).toBe('gitlab')

        await git.writeDoc(pc(), DOC, V1.replace('日曜', '土曜及び日曜'))
        draft = await git.createBranch(pc(), '2026年改定')
        await git.saveVersion(pc(), { message: '休日を変更' })
        await wf.addReview(pc(), { branch: draft, action: 'request', text: '' })

        expect(state.mrs).toMatchObject([{ iid: 1, source: draft, target: 'main', title: '改定案「2026年改定」の確認依頼', author: 'staff-a' }])
        expect(remoteRefs()).toContain(`refs/heads/${draft}`)
        const req = (await wf.listReviews(pc())).find((e) => e.action === 'request')!
        expect(req).toMatchObject({ pr: 1, forge: 'gitlab', forgeUser: 'staff-a' })
        expect(req.githubPr).toBeUndefined()
        await wf.addReview(pc(), { branch: draft, action: 'request', text: '再依頼' })
        expect(state.mrs.length).toBe(1)
    })

    it('依頼した本人の承認は数えない（GitLab が許しても）。承認されるまで反映できない', async () => {
        await wf.addReview(pc(), { branch: draft, action: 'approve', text: '' })
        expect([...state.approvals.get(1)!]).toEqual(['staff-a'])
        expect((await status()).state).toBe('requested')
        await expect(wf.adoptOrMerge(pc(), { from: draft, into: 'main', choices: {}, message: '反映' })).rejects.toThrow('まだ承認されていません')
        await as('staff-a', () => wf.addReview(pc(), { branch: draft, action: 'comment', text: '自分の承認は取り消します' }))
        state.approvals.get(1)!.delete('staff-a')
    })

    it('別の人の承認を GitLab から読み取る。承認後に改定案が変われば「承認後に変更あり」', async () => {
        await as('boss', () => wf.addReview(pc(), { branch: draft, action: 'approve', text: '' }))
        const events = (await wf.listReviews(pc())).filter((e) => e.branch === draft)
        expect(events.map((e) => `${e.action}:${e.by}:${e.source}`)).toContain('approve:boss:gitlab')
        expect(events.some((e) => e.action === 'comment' && e.text === '自分の承認は取り消します')).toBe(true)
        expect(state.notes.filter((n) => !n.system).map((n) => n.body)).not.toContain('承認します')
        expect((await status()).state).toBe('approved')

        await new Promise((r) => setTimeout(r, 5))
        await git.writeDoc(pc(), DOC, V1.replace('日曜', '土曜、日曜及び祝日'))
        await git.saveVersion(pc(), { message: '祝日も追加' })
        await git.pushRef(pc(), draft)
        expect((await status()).state).toBe('outdated')
    })

    it('修正依頼はコメントとして残り、もう一度の承認で承認済みに戻る', async () => {
        await new Promise((r) => setTimeout(r, 5))
        await as('boss', () => wf.addReview(pc(), { branch: draft, action: 'changes', text: '表記を確認してください' }))
        expect(state.approvals.get(1)!.has('boss')).toBe(false)
        const s = await status()
        expect(s.state).toBe('changes')
        expect(s.decision?.text).toBe('表記を確認してください')

        await new Promise((r) => setTimeout(r, 5))
        await as('boss', () => wf.addReview(pc(), { branch: draft, action: 'approve', text: 'OK です' }))
        expect((await status()).state).toBe('approved')
    })

    it('GitLab でマージして取り込む（マージできるかの確認を待つ）', async () => {
        const s = await wf.adoptOrMerge(pc(), {
            from: draft, into: 'main', choices: {}, message: '2026年改定を反映', effectiveDate: '2026-04-01', deleteAfter: true,
        })
        expect(s).toEqual({ state: 'upToDate' })
        expect(state.mrs[0]).toMatchObject({ state: 'merged' })
        expect(remoteMain()).toContain('土曜、日曜及び祝日')
        expect(await git.readDoc(pc(), DOC)).toContain('土曜、日曜及び祝日')
        expect(remoteRefs()).not.toContain(`refs/heads/${draft}`)
        expect(remoteRefs()).toContain('refs/tags/施行/株式会社A/就業規則/2026-04-01')
    })

    it('納品を GitLab のリリースに載せ、ファイルをアップロードしてリンクを付ける', async () => {
        const out = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-out-'))
        const [eff] = await git.listEffective(pc(), DOC)
        const bytes = (s: string) => async () => new TextEncoder().encode(s)
        const rec = await wf.deliver(
            pc(),
            { docPath: DOC, oid: eff.oid, to: '株式会社A', memo: '改定分', items: ['docPdf', 'cmpDocx'], publishRelease: true, effectiveDate: eff.date },
            out,
            { docPdf: bytes('pdf!'), docDocx: bytes(''), cmpPdf: bytes(''), cmpDocx: bytes('op') },
        )
        expect(rec.releaseError).toBeUndefined()
        expect(rec.releaseForge).toBe('gitlab')
        const [rel] = state.releases
        expect(rel.tag).toMatch(/^納品\/株式会社A\/就業規則\//)
        expect(rec.releaseUrl).toBe(`${BASE}/office/sub/docs/-/releases/${encodeURIComponent(rel.tag)}`)
        expect(rel.description).toContain('宛先：株式会社A')
        expect(rel.links).toEqual([
            { name: '就業規則.pdf', url: `${BASE}/-/project/1/uploads/abc/就業規則.pdf` },
            { name: '就業規則 新旧対照表.docx', url: `${BASE}/-/project/1/uploads/abc/就業規則 新旧対照表.docx` },
        ])
        expect(remoteRefs()).toContain(`refs/tags/${rel.tag}`)
    })

    it('記録ブランチに書かれた「GitLab で承認」は数えない', async () => {
        const b = await git.createBranch(pc(), '偽造の確認')
        await git.writeDoc(pc(), DOC, V1 + '\n### 追加\n- x\n')
        await git.saveVersion(pc(), { message: 'x' })
        await wf.addReview(pc(), { branch: b, action: 'request', text: '' })
        const oid = await git.branchOid(pc(), b)
        await records.writeRecord(pc(), 'reviews/forged.json', {
            id: 'forged', branch: b, action: 'approve', oid, by: 'boss', at: new Date(Date.now() + 1000).toISOString(), text: '', source: 'gitlab',
        })
        const s = reviewStatus(await wf.listReviews(pc()), b, oid, RULES)
        expect(s.state).toBe('requested')
    })
})
