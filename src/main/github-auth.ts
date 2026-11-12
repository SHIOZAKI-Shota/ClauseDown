import { GITHUB_APP } from '../shared/about'
import { GITHUB_BASE } from '../shared/forge'
import type { ForgeLogin } from '../shared/api'

export interface GitHubAccount {
    login: string | null
    method: 'app' | 'token' | null
}
import { credentialFromResponse, loadCredential, loadSettings, saveCredential, type OAuthResponse, type Profile } from './settings'

const webBase = () => process.env.CLAUSEDOWN_GITHUB_WEB ?? 'https://github.com'
const apiBase = () => process.env.CLAUSEDOWN_GITHUB_API ?? 'https://api.github.com'

export const BUILTIN_CLIENT_ID = GITHUB_APP.clientId

export async function clientId(): Promise<string> {
    const id = process.env.CLAUSEDOWN_GITHUB_CLIENT_ID || (await loadSettings()).githubClientId || BUILTIN_CLIENT_ID
    if (!id) throw new Error('GitHub App の Client ID が設定されていません。設定画面で入力してください')
    return id
}

async function post(path: string, body: Record<string, string>) {
    const res = await fetch(webBase() + path, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    return (await res.json()) as OAuthResponse
}

let pending: { deviceCode: string; interval: number; expiresAt: number; clientId: string } | null = null

export async function startLogin(): Promise<ForgeLogin> {
    const id = await clientId()
    const j = await post('/login/device/code', { client_id: id })
    if (!j.device_code) throw new Error(`GitHub にログインできません（${String(j.error_description ?? j.error ?? '不明なエラー')}）`)
    pending = {
        deviceCode: String(j.device_code),
        interval: Number(j.interval ?? 5),
        expiresAt: Date.now() + Number(j.expires_in ?? 900) * 1000,
        clientId: id,
    }
    return { userCode: String(j.user_code), verificationUri: String(j.verification_uri), expiresIn: Number(j.expires_in ?? 900) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function waitLogin(): Promise<GitHubAccount> {
    if (!pending) throw new Error('先に「GitHub でログイン」を押してください')
    const p = pending
    let interval = p.interval
    while (Date.now() < p.expiresAt) {
        await sleep(interval * 1000)
        if (pending !== p) throw new Error('ログインを中止しました')
        const j = await post('/login/oauth/access_token', {
            client_id: p.clientId,
            device_code: p.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        })
        if (j.access_token) {
            const who = await whoAmI(String(j.access_token))
            await saveCredential(GITHUB_BASE, credentialFromResponse(j, 'github', p.clientId, who))
            pending = null
            return { login: who?.login ?? null, method: 'app' }
        }
        if (j.error === 'authorization_pending') continue
        if (j.error === 'slow_down') {
            interval = Number(j.interval ?? interval + 5)
            continue
        }
        pending = null
        if (j.error === 'access_denied') throw new Error('GitHub でのログインが取り消されました')
        if (j.error === 'expired_token') break
        throw new Error(`GitHub にログインできません（${String(j.error_description ?? j.error)}）`)
    }
    pending = null
    throw new Error('コードの有効期限が切れました。もう一度「GitHub でログイン」を押してください')
}

export async function whoAmI(token: string): Promise<Profile | null> {
    const get = (path: string) => fetch(apiBase() + path, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } })
    try {
        const res = await get('/user')
        if (!res.ok) return null
        const u = (await res.json()) as { login?: string; id?: number; name?: string | null; email?: string | null }
        if (typeof u?.login !== 'string' || !u.login) return null
        const login = u.login
        let email = u.email || ''
        if (!email) {
            const r = await get('/user/emails').catch(() => null)
            if (r?.ok) {
                const list = (await r.json().catch(() => [])) as { email: string; primary?: boolean; verified?: boolean }[]
                email = (Array.isArray(list) ? list.find((e) => e.primary && e.verified)?.email : '') ?? ''
            }
        }
        if (!email && u.id) email = `${u.id}+${login}@users.noreply.github.com`
        return { login, name: u.name?.trim() || login, email }
    } catch {
        return null
    }
}

export async function account(): Promise<GitHubAccount> {
    const c = await loadCredential(GITHUB_BASE)
    if (!c) return { login: null, method: null }
    return { login: c.login ?? (c.method === 'token' ? '（トークン）' : null), method: c.method }
}

export async function logout(): Promise<void> {
    pending = null
    await saveCredential(GITHUB_BASE, null)
}
