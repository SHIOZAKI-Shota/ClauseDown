import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

const web = () => process.env.CLAUSEDOWN_OPENROUTER_WEB ?? 'https://openrouter.ai'
const api = () => process.env.CLAUSEDOWN_OPENROUTER_API ?? 'https://openrouter.ai/api/v1'
const TIMEOUT = () => Number(process.env.CLAUSEDOWN_OPENROUTER_TIMEOUT_MS ?? 5 * 60 * 1000)

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const PAGE = (msg: string) => `<!doctype html><meta charset="utf-8"><title>ClauseDown</title><body style="font-family:sans-serif;padding:40px">${msg}</body>`

let current: (() => void) | null = null

export async function loginOpenRouter(open: (url: string) => Promise<void>): Promise<string> {
    current?.()
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const nonce = b64url(randomBytes(16))

    let done!: (code: string) => void
    let fail!: (e: Error) => void
    const got = new Promise<string>((res, rej) => {
        done = res
        fail = rej
    })
    const handler: http.RequestListener = (req, res) => {
        const u = new URL(req.url ?? '/', 'http://localhost')
        const code = u.searchParams.get('code')
        if (u.pathname !== `/cb/${nonce}` || !code) {
            res.writeHead(404).end()
            return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(PAGE('ログインできました。ClauseDown に戻ってください。このページは閉じてかまいません。'))
        done(code)
    }

    const v4 = http.createServer(handler)
    await new Promise<void>((r, j) => v4.once('error', j).listen(0, '127.0.0.1', () => r()))
    const port = (v4.address() as AddressInfo).port
    const v6 = http.createServer(handler)
    await new Promise<void>((r) => v6.once('error', () => r()).listen(port, '::1', () => r()))
    const close = () => {
        v4.close()
        v6.close()
    }
    const timer = setTimeout(() => fail(new Error('ログインの時間が切れました。もう一度「OpenRouter でログイン」を押してください')), TIMEOUT())
    current = () => fail(new Error('ログインを中止しました'))

    try {
        const callback = `http://localhost:${port}/cb/${nonce}`
        await open(`${web()}/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`)
        const code = await got
        const res = await fetch(`${api()}/auth/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        })
        const j = (await res.json().catch(() => ({}))) as { key?: string; error?: { message?: string } | string }
        if (!res.ok || !j.key) {
            const m = typeof j.error === 'string' ? j.error : j.error?.message
            throw new Error(`OpenRouter のキーを受け取れませんでした（${m ?? `HTTP ${res.status}`}）`)
        }
        return j.key
    } finally {
        clearTimeout(timer)
        current = null
        close()
    }
}
