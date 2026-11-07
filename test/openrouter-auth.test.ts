import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { loginOpenRouter } from '../src/main/ai/openrouter-auth'

let server: http.Server
let exchanged: Record<string, string> | null = null

beforeAll(async () => {
    server = http.createServer(async (req, res) => {
        const raw: Buffer[] = []
        for await (const c of req) raw.push(c as Buffer)
        if (req.url === '/api/v1/auth/keys' && req.method === 'POST') {
            exchanged = JSON.parse(Buffer.concat(raw).toString())
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ key: 'sk-or-v1-test' }))
        }
        res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    process.env.CLAUSEDOWN_OPENROUTER_WEB = `http://127.0.0.1:${port}`
    process.env.CLAUSEDOWN_OPENROUTER_API = `http://127.0.0.1:${port}/api/v1`
})
afterAll(() => {
    server?.close()
    delete process.env.CLAUSEDOWN_OPENROUTER_WEB
    delete process.env.CLAUSEDOWN_OPENROUTER_API
    delete process.env.CLAUSEDOWN_OPENROUTER_TIMEOUT_MS
})

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('OpenRouter のログイン', () => {
    it('ブラウザから戻った code を、PKCE の秘密の値と一緒にキーに換える', async () => {
        let challenge = ''
        const key = await loginOpenRouter(async (url) => {
            const u = new URL(url)
            expect(u.pathname).toBe('/auth')
            expect(u.searchParams.get('code_challenge_method')).toBe('S256')
            challenge = u.searchParams.get('code_challenge')!
            const cb = new URL(u.searchParams.get('callback_url')!)
            expect(cb.hostname).toBe('localhost')
            const port = cb.port
            expect((await fetch(`http://127.0.0.1:${port}/cb/wrong?code=evil`)).status).toBe(404)
            const res = await fetch(`http://127.0.0.1:${port}${cb.pathname}?code=CODE123`)
            expect(await res.text()).toContain('ログインできました')
        })
        expect(key).toBe('sk-or-v1-test')
        expect(exchanged).toMatchObject({ code: 'CODE123', code_challenge_method: 'S256' })
        expect(b64url(createHash('sha256').update(exchanged!.code_verifier).digest())).toBe(challenge)
    })

    it('戻ってこなければ時間切れにする', async () => {
        process.env.CLAUSEDOWN_OPENROUTER_TIMEOUT_MS = '100'
        await expect(loginOpenRouter(async () => { })).rejects.toThrow('時間が切れました')
    })
})
