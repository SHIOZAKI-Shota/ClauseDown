import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'

const userData = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-ud-'))
vi.mock('electron', () => ({
    app: { getPath: () => userData },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
    },
}))
const settings = await import('../src/main/settings')
const accounts = await import('../src/main/accounts')
const { onAuth } = await import('../src/main/git-base')

const BASE = 'https://gitlab.example.co.jp'
let server: http.Server
let polls = 0
let issued = 0
const requests: Record<string, string>[] = []

beforeAll(async () => {
    server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const raw = Buffer.concat(chunks).toString()
        const body = req.headers['content-type']?.includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : {}
        requests.push({ path: req.url!, ...body })
        const send = (status: number, data: unknown) => {
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
        }
        if (req.url === '/oauth/authorize_device') {
            return send(200, {
                device_code: 'DEV',
                user_code: 'WXYZ-9876',
                verification_uri: `${addr()}/oauth/device`,
                verification_uri_complete: `${addr()}/oauth/device?user_code=WXYZ-9876`,
                expires_in: 300,
                interval: 0,
            })
        }
        if (req.url === '/oauth/token') {
            if (body.grant_type === 'refresh_token') {
                issued++
                return send(200, { access_token: `glo_new${issued}`, refresh_token: `glr_new${issued}`, expires_in: 7200 })
            }
            if (polls++ === 0) return send(400, { error: 'authorization_pending' })
            return send(200, { access_token: 'glo_first', refresh_token: 'glr_first', expires_in: 60 })
        }
        if (req.url === '/user') {
            const auth = req.headers.authorization
            if (auth === 'Bearer bad') return send(401, { message: '401 Unauthorized' })
            if (auth?.startsWith('Bearer ghp_')) return send(401, { message: 'Bad credentials' })
            return send(200, { username: 'staff-a', id: 7, name: '山田', commit_email: 'yamada@example.co.jp', email: 'y@example.com' })
        }
        send(404, {})
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    process.env.CLAUSEDOWN_GITLAB_WEB = addr()
    process.env.CLAUSEDOWN_GITLAB_API = addr()
    process.env.CLAUSEDOWN_GITHUB_API = addr()
    fs.writeFileSync(
        join(userData, 'settings.json'),
        JSON.stringify({
            repos: [],
            author: { name: 't', email: '' },
            gitlabHosts: [{ url: `${BASE}/`, clientId: 'app-123' }, { url: 'http://insecure.example.com' }],
        }),
    )
})
const addr = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`
afterAll(() => {
    server?.close()
    delete process.env.CLAUSEDOWN_GITLAB_WEB
    delete process.env.CLAUSEDOWN_GITLAB_API
    delete process.env.CLAUSEDOWN_GITHUB_API
})

describe('GitLab のログイン', () => {
    it('社内の GitLab は https のものだけ登録され、一覧に出る', async () => {
        const list = await accounts.accounts()
        expect(list.map((a) => [a.base, a.kind, a.deviceLogin])).toEqual([
            ['https://github.com', 'github', true],
            ['https://gitlab.com', 'gitlab', true],
            [BASE, 'gitlab', true],
        ])
        await expect(accounts.loginStart('https://evil.example.com')).rejects.toThrow('登録されていないサーバー')
    })

    it('コードを表示し、入力されるまで待ってからログインする', async () => {
        const info = await accounts.loginStart(BASE)
        expect(info).toMatchObject({ userCode: 'WXYZ-9876', verificationUri: `${addr()}/oauth/device?user_code=WXYZ-9876` })
        expect(requests[0]).toMatchObject({ path: '/oauth/authorize_device', client_id: 'app-123', scope: 'api read_repository write_repository' })
        const acc = await accounts.loginWait(BASE)
        expect(acc).toMatchObject({ base: BASE, login: 'staff-a', method: 'app' })
        expect(polls).toBe(2)
    })

    it('期限が近いトークンは client secret なしで更新し、新しい refresh token を保存する', async () => {
        expect(await settings.getToken(BASE)).toBe('glo_new1')
        const r = requests.find((x) => x.grant_type === 'refresh_token')!
        expect(r).toMatchObject({ path: '/oauth/token', client_id: 'app-123', refresh_token: 'glr_first' })
        expect(r).not.toHaveProperty('client_secret')
        expect((await settings.loadCredential(BASE))?.refresh).toBe('glr_new1')
        expect(await settings.getToken(BASE)).toBe('glo_new1')
        expect(issued).toBe(1)
    })

    it('GitLab のトークンは GitLab にだけ、ユーザー名 oauth2 で渡す。GitHub のトークンとは別に持つ', async () => {
        await accounts.setToken('https://github.com', 'ghp_x')
        expect(await onAuth(`${BASE}/office/docs.git`, {} as never)).toEqual({ username: 'oauth2', password: 'glo_new1' })
        expect(await onAuth('https://github.com/office/docs.git', {} as never)).toMatchObject({ password: 'ghp_x' })
        expect(await onAuth('https://gitlab.example.co.jp.evil.com/a/b.git', {} as never)).toEqual({ cancel: true })
        expect(await onAuth('https://gitlab.com/a/b.git', {} as never)).toEqual({ cancel: true })
    })

    it('アクセストークンは持ち主を確かめてから保存する。ログアウトはそのサーバーだけ', async () => {
        await expect(accounts.setToken('https://gitlab.com', 'bad')).rejects.toThrow('ログインできませんでした')
        expect(await settings.loadCredential('https://gitlab.com')).toBeNull()
        await accounts.setToken('https://gitlab.com', 'glpat-ok')
        expect((await accounts.accounts()).find((a) => a.base === 'https://gitlab.com')).toMatchObject({
            login: 'staff-a',
            method: 'token',
            name: '山田',
            email: 'yamada@example.co.jp',
        })

        await accounts.logout(BASE)
        expect(await settings.getToken(BASE)).toBeNull()
        expect(await settings.getToken('https://github.com')).toBe('ghp_x')
        expect(await settings.getToken('https://gitlab.com')).toBe('glpat-ok')
    })

    it('以前の版の認証情報（GitHub の1つだけ）は GitHub のものとして読む', async () => {
        fs.writeFileSync(join(userData, 'token.bin'), JSON.stringify({ method: 'token', access: 'ghp_old' }))
        expect(await settings.getToken()).toBe('ghp_old')
        expect(await settings.getToken(BASE)).toBeNull()
        await settings.setToken(BASE, 'glpat-2', 'gitlab')
        const saved = JSON.parse(fs.readFileSync(join(userData, 'token.bin'), 'utf8'))
        expect(saved.v).toBe(2)
        expect(Object.keys(saved.hosts).sort()).toEqual(['https://github.com', BASE].sort())
    })
})
