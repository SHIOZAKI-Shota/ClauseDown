import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startGitServer } from './git-server'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: '事務員A', email: 'a@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const wf = await import('../src/main/workflow')

let root = ''
let url = ''
let closeGit = () => { }
let api: http.Server
const state = {
    login: 'staff-a',
    pulls: [] as { number: number; head: string; base: string; title: string; author: string; state: string; merged: boolean }[],
    reviews: [] as { id: number; pr: number; user: { login: string }; state: string; body: string; commit_id: string; submitted_at: string }[],
    releases: [] as { id: number; tag: string; name: string; body: string; assets: string[] }[],
}

function mergeOnServer(head: string, title: string): string {
    const work = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-gh-'))
    const bare = join(root, 'docs.git')
    const g = (...args: string[]) => execFileSync('git', ['-C', work, '-c', 'user.name=GitHub', '-c', 'user.email=gh@example.com', ...args]).toString().trim()
    execFileSync('git', ['clone', '-q', bare, work])
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
        const base = '/repos/office/docs'
        const pull = (n: number) => state.pulls.find((x) => x.number === n)!
        const toJson = (x: (typeof state.pulls)[number]) => ({
            number: x.number, html_url: `https://github.com/office/docs/pull/${x.number}`, state: x.state, merged: x.merged,
            head: { ref: x.head, sha: '' },
        })
        let m: RegExpExecArray | null
        if (req.method === 'GET' && p === `${base}/pulls`) {
            const head = u.searchParams.get('head')!.split(':')[1]
            return send(200, state.pulls.filter((x) => x.state === 'open' && x.head === head).map(toJson))
        }
        if (req.method === 'POST' && p === `${base}/pulls`) {
            const pr = { number: state.pulls.length + 1, ...body, author: state.login, state: 'open', merged: false }
            state.pulls.push(pr)
            return send(201, toJson(pr))
        }
        if ((m = new RegExp(`^${base}/pulls/(\\d+)/reviews$`).exec(p))) {
            const n = Number(m[1])
            if (req.method === 'GET') return send(200, state.reviews.filter((r) => r.pr === n))
            if (pull(n).author === state.login && body.event === 'APPROVE') {
                return send(422, { message: 'Unprocessable Entity', errors: [{ message: 'Can not approve your own pull request' }] })
            }
            const st = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' }[body.event as string]!
            const r = { id: state.reviews.length + 1, pr: n, user: { login: state.login }, state: st, body: body.body, commit_id: body.commit_id, submitted_at: new Date().toISOString() }
            state.reviews.push(r)
            return send(200, r)
        }
        if ((m = new RegExp(`^${base}/pulls/(\\d+)/merge$`).exec(p)) && req.method === 'PUT') {
            const pr = pull(Number(m[1]))
            if (!state.reviews.some((r) => r.pr === pr.number && r.state === 'APPROVED')) {
                return send(405, { message: 'At least 1 approving review is required by reviewers with write access. (protected branch)' })
            }
            const sha = mergeOnServer(pr.head, body.commit_title)
            pr.state = 'closed'
            pr.merged = true
            return send(200, { merged: true, sha })
        }
        if ((m = new RegExp(`^${base}/pulls/(\\d+)$`).exec(p)) && req.method === 'PATCH') {
            pull(Number(m[1])).state = body.state
            return send(200, toJson(pull(Number(m[1]))))
        }
        if (req.method === 'POST' && p === `${base}/releases`) {
            const r = { id: state.releases.length + 1, tag: body.tag_name, name: body.name, body: body.body, assets: [] as string[] }
            state.releases.push(r)
            const addr = api.address() as { port: number }
            return send(201, {
                id: r.id,
                html_url: `https://github.com/office/docs/releases/${r.id}`,
                upload_url: `http://127.0.0.1:${addr.port}/uploads/${r.id}/assets{?name,label}`,
            })
        }
        if ((m = /^\/uploads\/(\d+)\/assets$/.exec(p)) && req.method === 'POST') {
            state.releases.find((r) => r.id === Number(m![1]))!.assets.push(`${u.searchParams.get('name')}:${raw.length}`)
            return send(201, { browser_download_url: 'x' })
        }
        send(404, { message: `Not Found ${req.method} ${p}` })
    })
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()))
    process.env.CLAUSEDOWN_GITHUB_API = `http://127.0.0.1:${(api.address() as { port: number }).port}`
    process.env.CLAUSEDOWN_GITHUB_REPO = 'office/docs'
})
afterAll(() => {
    closeGit()
    api?.close()
    delete process.env.CLAUSEDOWN_GITHUB_API
    delete process.env.CLAUSEDOWN_GITHUB_REPO
})

const DOC = '株式会社A/就業規則.md'
const V1 = '# 就業規則\n\n### 休日\n- 日曜\n'
const remoteMain = () => execFileSync('git', ['-C', join(root, 'docs.git'), 'show', 'main:' + DOC]).toString()
const remoteRefs = () => execFileSync('git', ['-C', join(root, 'docs.git'), 'show-ref']).toString()

describe('GitHub 連携', () => {
    const pc = () => join(root, 'pc')
    let draft = ''

    it('確認依頼でプルリクを作る', async () => {
        await git.cloneRepo(url, pc())
        await git.writeDoc(pc(), DOC, V1)
        await git.saveVersion(pc(), { message: '初版' })
        await git.push(pc())
        await wf.saveRules(pc(), { requireApproval: true, approvers: [] })

        await git.writeDoc(pc(), DOC, V1.replace('日曜', '土曜及び日曜'))
        draft = await git.createBranch(pc(), '2026年改定')
        await git.saveVersion(pc(), { message: '休日を変更' })
        await wf.addReview(pc(), { branch: draft, action: 'request', text: '' })

        expect(state.pulls).toMatchObject([{ number: 1, head: draft, base: 'main', title: '改定案「2026年改定」の確認依頼' }])
        expect(remoteRefs()).toContain(`refs/heads/${draft}`)
        await wf.addReview(pc(), { branch: draft, action: 'request', text: '再依頼' })
        expect(state.pulls.length).toBe(1)
    })

    it('自分のプルリクは GitHub が承認させない。承認されるまで反映できない', async () => {
        await expect(wf.addReview(pc(), { branch: draft, action: 'approve', text: '' })).rejects.toThrow('自分が依頼した改定案は')
        await expect(wf.adoptOrMerge(pc(), { from: draft, into: 'main', choices: {}, message: '反映' })).rejects.toThrow('まだ承認されていません')
    })

    it('別のアカウントの承認を GitHub から読み取り、GitHub でマージして取り込む', async () => {
        state.login = 'boss'
        await wf.addReview(pc(), { branch: draft, action: 'approve', text: 'OK' })
        state.login = 'staff-a'
        const events = (await wf.listReviews(pc())).filter((e) => e.branch === draft)
        expect(events.map((e) => `${e.action}:${e.by}:${e.source}`)).toContain('approve:boss:github')

        const s = await wf.adoptOrMerge(pc(), {
            from: draft, into: 'main', choices: {}, message: '2026年改定を反映', effectiveDate: '2026-04-01', deleteAfter: true,
        })
        expect(s).toEqual({ state: 'upToDate' })
        expect(state.pulls[0]).toMatchObject({ state: 'closed', merged: true })
        expect(remoteMain()).toContain('土曜及び日曜')
        expect(await git.readDoc(pc(), DOC)).toContain('土曜及び日曜')
        expect((await git.listBranches(pc())).map((b) => b.label)).toEqual(['現行版'])
        expect(remoteRefs()).not.toContain(`refs/heads/${draft}`)
        expect(remoteRefs()).toContain('refs/tags/施行/株式会社A/就業規則/2026-04-01')
    })

    it('納品を GitHub の Releases に載せる', async () => {
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
        expect(rec.releaseUrl).toBe('https://github.com/office/docs/releases/1')
        expect(state.releases[0]).toMatchObject({ assets: ['就業規則.pdf:4', '就業規則 新旧対照表.docx:2'] })
        expect(state.releases[0].tag).toMatch(/^納品\/株式会社A\/就業規則\//)
        expect(state.releases[0].body).toContain('宛先：株式会社A')
        expect(remoteRefs()).toContain(`refs/tags/${state.releases[0].tag}`)
    })
})
