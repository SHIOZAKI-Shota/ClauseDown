import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: '事務員A', email: 'a@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const issues = await import('../src/main/issues')

interface FakeIssue {
    n: number
    title: string
    body: string
    state: 'open' | 'closed'
    comments: string[]
}
const site = { next: 1, issues: [] as FakeIssue[] }
let api: http.Server

function serve(kind: 'github' | 'gitlab') {
    return async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
        const u = new URL(req.url!, 'http://x')
        const send = (status: number, data: unknown) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
        }
        const gh = (i: FakeIssue) => ({
            number: i.n,
            title: i.title,
            body: i.body,
            state: i.state,
            user: { login: 'staff' },
            created_at: '2026-01-01T00:00:00Z',
            closed_at: null,
            html_url: `https://github.com/office/docs/issues/${i.n}`,
        })
        const gl = (i: FakeIssue) => ({
            iid: i.n,
            title: i.title,
            description: i.body,
            state: i.state === 'open' ? 'opened' : 'closed',
            author: { username: 'staff' },
            created_at: '2026-01-01T00:00:00Z',
            closed_at: null,
            web_url: `https://gitlab.example.com/office/docs/-/issues/${i.n}`,
        })
        const map = (i: FakeIssue): object => (kind === 'github' ? gh(i) : gl(i))
        const base = kind === 'github' ? '/repos/office/docs/issues' : `/projects/${encodeURIComponent('office/docs')}/issues`
        const p = decodeURIComponent(u.pathname).replace(decodeURIComponent(base), '@')
        let m: RegExpExecArray | null
        if (req.method === 'GET' && p === '@') return send(200, Number(u.searchParams.get('page') ?? 1) > 1 ? [] : site.issues.map(map))
        if (req.method === 'POST' && p === '@') {
            const i: FakeIssue = { n: site.next++, title: body.title, body: body.body ?? body.description ?? '', state: 'open', comments: [] }
            site.issues.push(i)
            return send(201, map(i))
        }
        if ((m = /^@\/(\d+)$/.exec(p)) && (req.method === 'PATCH' || req.method === 'PUT')) {
            const i = site.issues.find((x) => x.n === Number(m![1]))!
            if (body.title) i.title = body.title
            if (body.body !== undefined) i.body = body.body
            if (body.description !== undefined) i.body = body.description
            if (body.state) i.state = body.state
            if (body.state_event) i.state = body.state_event === 'close' ? 'closed' : 'open'
            return send(200, map(i))
        }
        if ((m = /^@\/(\d+)\/(comments|notes)$/.exec(p))) {
            const i = site.issues.find((x) => x.n === Number(m![1]))!
            if (req.method === 'POST') {
                i.comments.push(body.body)
                return send(201, {})
            }
            if (Number(u.searchParams.get('page') ?? 1) > 1) return send(200, [])
            return send(
                200,
                i.comments.map((c, k) => ({ id: k + 1, body: c, user: { login: 'staff' }, author: { username: 'staff' }, created_at: '2026-01-01T00:00:00Z' })),
            )
        }
        send(404, { message: `not found ${req.method} ${u.pathname}` })
    }
}

async function startApi(kind: 'github' | 'gitlab') {
    api = http.createServer(serve(kind))
    await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()))
    return `http://127.0.0.1:${(api.address() as { port: number }).port}`
}

async function newRepo() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-issues-forge-'))
    await git.initRepo(dir)
    await git.writeDoc(dir, '規程.md', '# 規程\n### 目的\n- 定める。\n')
    await git.saveVersion(dir, { message: '初版' })
    return dir
}

const useGitHub = (url: string) => {
    process.env.CLAUSEDOWN_GITHUB_API = url
    process.env.CLAUSEDOWN_GITHUB_REPO = 'office/docs'
}
const noForge = () => {
    delete process.env.CLAUSEDOWN_GITHUB_REPO
    delete process.env.CLAUSEDOWN_GITLAB_REPO
}

describe('課題（GitHub）', () => {
    let url = ''
    beforeAll(async () => (url = await startApi('github')))
    afterAll(() => {
        noForge()
        delete process.env.CLAUSEDOWN_GITHUB_API
        api.close()
    })
    beforeEach(() => {
        site.next = 1
        site.issues = []
        useGitHub(url)
    })

    it('作成・一覧・更新は GitHub の課題そのもの。紐付けと版を指定した閉じ方はコメントになる', async () => {
        const dir = await newRepo()
        const c = await issues.createIssue(dir, { title: '休日の見直し', body: '第2条' })
        expect(c).toMatchObject({ n: 1, source: 'github', url: 'https://github.com/office/docs/issues/1' })
        const [head] = await git.log(dir)
        await issues.linkIssue(dir, 1, head.oid)
        expect(site.issues[0].comments[0]).toBe(`版 ${head.oid}「初版」を紐付けました（ClauseDown）`)
        await issues.closeIssue(dir, 1, head.oid)
        expect(site.issues[0].state).toBe('closed')
        const d = await issues.issueDetail(dir, 1)
        expect(d.versions).toEqual([expect.objectContaining({ oid: head.oid, how: 'close' })])
        await issues.updateIssue(dir, 1, { state: 'open', title: '休日' })
        expect(site.issues[0]).toMatchObject({ state: 'open', title: '休日' })
    })

    it('コメントはサイトのコメントになる。アプリの紐付けのコメントは記録として区別する', async () => {
        const dir = await newRepo()
        await issues.createIssue(dir, { title: 'A' })
        const [head] = await git.log(dir)
        await issues.linkIssue(dir, 1, head.oid)
        await issues.commentIssue(dir, 1, '先方に確認中です')
        await expect(issues.commentIssue(dir, 1, '  ')).rejects.toThrow('コメントを書いて')
        expect(site.issues[0].comments).toHaveLength(2)
        const d = await issues.issueDetail(dir, 1)
        expect(d.comments.map((c) => [c.kind, c.by])).toEqual([
            ['link', 'staff'],
            ['user', 'staff'],
        ])
        expect(d.comments[0].oid).toBe(head.oid)
        expect(d.comments[1].body).toBe('先方に確認中です')
    })

    it('改定案に紐付けた課題は、確認依頼の説明に Closes を入れ、反映したら API で閉じる', async () => {
        const dir = await newRepo()
        await issues.createIssue(dir, { title: 'A' })
        await issues.setBranchIssues(dir, '案/改定', [1])
        expect(await issues.reviewBodyLines(dir, '案/改定')).toBe('Closes #1')
        const [head] = await git.log(dir)
        expect(await issues.afterMain(dir, [{ oid: head.oid, message: head.message }], '案/改定')).toEqual([1])
        expect(site.issues[0].state).toBe('closed')
        expect(site.issues[0].comments[0]).toContain('で解決しました')
    })

    it('ローカルの課題を移すと、空のリポジトリでは番号がそのまま一致する。閉じた課題は閉じて移す', async () => {
        noForge()
        const dir = await newRepo()
        await issues.createIssue(dir, { title: 'A' })
        await issues.createIssue(dir, { title: 'B' })
        await issues.commentIssue(dir, 1, '一つ目')
        await issues.commentIssue(dir, 1, '二つ目')
        const [head] = await git.log(dir)
        await issues.closeIssue(dir, 2, head.oid)
        useGitHub(url)
        expect(await issues.pendingLocalIssues(dir)).toBe(2)
        expect(await issues.moveIssuesToForge(dir)).toEqual({ moved: 2, renumbered: [] })
        expect(site.issues.map((i) => [i.n, i.title, i.state])).toEqual([
            [1, 'A', 'open'],
            [2, 'B', 'closed'],
        ])
        expect(site.issues[0].comments).toEqual([
            expect.stringMatching(/^（事務員A・\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} のコメント）\n\n一つ目$/),
            expect.stringContaining('二つ目'),
        ])
        expect(await issues.pendingLocalIssues(dir)).toBe(0)
    })

    it('すでに課題やプルリクエストがあって番号がずれるときは、新しい本文に旧番号を残す', async () => {
        noForge()
        const dir = await newRepo()
        await issues.createIssue(dir, { title: 'A' })
        useGitHub(url)
        site.issues.push({ n: site.next++, title: '既存', body: '', state: 'open', comments: [] })
        const r = await issues.moveIssuesToForge(dir)
        expect(r.renumbered).toEqual([{ from: 1, to: 2 }])
        expect(site.issues[1].body).toContain('ClauseDown での旧番号 #1')
    })
})

describe('課題（GitLab）', () => {
    let url = ''
    beforeAll(async () => {
        url = await startApi('gitlab')
        process.env.CLAUSEDOWN_GITLAB_API = url
    })
    afterAll(() => {
        noForge()
        delete process.env.CLAUSEDOWN_GITLAB_API
        api.close()
    })

    it('GitLab の課題（iid・opened/closed・state_event）として扱う', async () => {
        site.next = 1
        site.issues = []
        noForge()
        process.env.CLAUSEDOWN_GITLAB_REPO = 'https://gitlab.example.com|office/docs'
        const dir = await newRepo()
        expect(await issues.createIssue(dir, { title: 'A', body: 'x' })).toMatchObject({ n: 1, source: 'gitlab', state: 'open' })
        await issues.closeIssue(dir, 1)
        expect((await issues.listIssues(dir))[0].state).toBe('closed')
        await issues.updateIssue(dir, 1, { state: 'open' })
        expect(site.issues[0].state).toBe('open')
    })
})
