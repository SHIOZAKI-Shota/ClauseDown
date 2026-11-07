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
const auth = await import('../src/main/github-auth')

let server: http.Server
let polls = 0
let issued = 0
const requests: Record<string, unknown>[] = []

beforeAll(async () => {
    server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const c of req) chunks.push(c as Buffer)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
        requests.push({ path: req.url, ...body })
        const send = (data: unknown) => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(data))
        }
        if (req.url === '/login/device/code') {
            return send({ device_code: 'DEV', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0 })
        }
        if (req.url === '/login/oauth/access_token') {
            if (body.grant_type === 'refresh_token') {
                issued++
                return send({ access_token: `ghu_new${issued}`, refresh_token: `ghr_new${issued}`, expires_in: 28800, refresh_token_expires_in: 15897600 })
            }
            if (polls++ === 0) return send({ error: 'authorization_pending' })
            return send({ access_token: 'ghu_first', refresh_token: 'ghr_first', expires_in: 60, refresh_token_expires_in: 15897600 })
        }
        if (req.url === '/user') return send({ login: 'staff-a', id: 42, name: '山田 太郎', email: null })
        if (req.url === '/user/emails') return res.writeHead(403).end()
        res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    process.env.CLAUSEDOWN_GITHUB_WEB = base
    process.env.CLAUSEDOWN_GITHUB_API = base
    process.env.CLAUSEDOWN_GITHUB_CLIENT_ID = 'Iv1.test'
})
afterAll(() => {
    server?.close()
    delete process.env.CLAUSEDOWN_GITHUB_WEB
    delete process.env.CLAUSEDOWN_GITHUB_API
    delete process.env.CLAUSEDOWN_GITHUB_CLIENT_ID
})

describe('GitHub App のログイン', () => {
    it('コードを表示し、入力されるまで待ってからログインする', async () => {
        const info = await auth.startLogin()
        expect(info).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
        expect(await auth.waitLogin()).toEqual({ login: 'staff-a', method: 'app' })
        expect(polls).toBe(2)
        expect(await auth.account()).toEqual({ login: 'staff-a', method: 'app' })
        expect(await settings.loadCredential()).toMatchObject({ name: '山田 太郎', email: '42+staff-a@users.noreply.github.com' })
    })

    it('期限が近いトークンは、client secret なしで更新してから使う', async () => {
        expect(await settings.getToken()).toBe('ghu_new1')
        const refreshReq = requests.find((r) => r.grant_type === 'refresh_token')!
        expect(refreshReq).toMatchObject({ client_id: 'Iv1.test', refresh_token: 'ghr_first' })
        expect(refreshReq).not.toHaveProperty('client_secret')
        expect(await settings.getToken()).toBe('ghu_new1')
        expect(issued).toBe(1)
        expect(await settings.loadCredential()).toMatchObject({ login: 'staff-a', name: '山田 太郎' })
    })

    it('以前の版で保存したトークンも読める。ログアウトで消える', async () => {
        fs.writeFileSync(join(userData, 'token.bin'), 'ghp_legacy')
        expect(await settings.getToken()).toBe('ghp_legacy')
        expect(await auth.account()).toEqual({ login: '（トークン）', method: 'token' })
        await auth.logout()
        expect(await settings.getToken()).toBeNull()
    })
})
