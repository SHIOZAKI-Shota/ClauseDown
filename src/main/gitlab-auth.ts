import { GITLAB_APP } from '../shared/about'
import { GITLAB_BASE } from '../shared/forge'
import type { ForgeLogin } from '../shared/api'
import { credentialFromResponse, gitlabWeb, loadSettings, saveCredential, type OAuthResponse, type Profile } from './settings'

export const gitlabApi = (base: string) => process.env.CLAUSEDOWN_GITLAB_API ?? `${base}/api/v4`

const SCOPE = 'api read_repository write_repository'

export async function clientIdFor(base: string): Promise<string | null> {
    if (process.env.CLAUSEDOWN_GITLAB_CLIENT_ID) return process.env.CLAUSEDOWN_GITLAB_CLIENT_ID
    const s = await loadSettings()
    if (base === GITLAB_BASE) return s.gitlabClientId || GITLAB_APP.clientId || null
    return s.gitlabHosts?.find((h) => h.url === base)?.clientId || null
}

async function post(base: string, path: string, body: Record<string, string>) {
    const res = await fetch(gitlabWeb(base) + path, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    })
    return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as OAuthResponse
}

interface Pending {
    deviceCode: string
    interval: number
    expiresAt: number
    clientId: string
}
const pending = new Map<string, Pending>()

export async function startLogin(base: string): Promise<ForgeLogin> {
    const id = await clientIdFor(base)
    if (!id) throw new Error('この GitLab の OAuth アプリの Application ID が設定されていません。管理者に登録してもらうか、アクセストークンを入力してください')
    const j = await post(base, '/oauth/authorize_device', { client_id: id, scope: SCOPE })
    if (!j.device_code) {
        throw new Error(`GitLab にログインできません（${String(j.error_description ?? j.error ?? '不明なエラー')}）。GitLab が古い場合は、アクセストークンを入力してください`)
    }
    pending.set(base, {
        deviceCode: String(j.device_code),
        interval: Number(j.interval ?? 5),
        expiresAt: Date.now() + Number(j.expires_in ?? 300) * 1000,
        clientId: id,
    })
    const pick = [j.verification_uri_complete, j.verification_uri].map(String).find((u) => u.startsWith(gitlabWeb(base) + '/'))
    return {
        userCode: String(j.user_code),
        verificationUri: pick ?? `${base}/oauth/device`,
        expiresIn: Number(j.expires_in ?? 300),
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function waitLogin(base: string): Promise<string | null> {
    const p = pending.get(base)
    if (!p) throw new Error('先に「ログイン」を押してください')
    let interval = p.interval
    while (Date.now() < p.expiresAt) {
        await sleep(interval * 1000)
        if (pending.get(base) !== p) throw new Error('ログインを中止しました')
        const j = await post(base, '/oauth/token', {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: p.deviceCode,
            client_id: p.clientId,
        })
        if (j.access_token) {
            const who = await whoAmI(base, String(j.access_token))
            await saveCredential(base, credentialFromResponse(j, 'gitlab', p.clientId, who))
            pending.delete(base)
            return who?.login ?? null
        }
        if (j.error === 'authorization_pending') continue
        if (j.error === 'slow_down') {
            interval += 5
            continue
        }
        pending.delete(base)
        if (j.error === 'access_denied') throw new Error('GitLab でのログインが取り消されました')
        if (j.error === 'expired_token') break
        throw new Error(`GitLab にログインできません（${String(j.error_description ?? j.error)}）`)
    }
    pending.delete(base)
    throw new Error('コードの有効期限が切れました。もう一度「ログイン」を押してください')
}

export async function whoAmI(base: string, token: string): Promise<Profile | null> {
    try {
        const res = await fetch(gitlabApi(base) + '/user', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return null
        const u = (await res.json()) as {
            username?: string
            id?: number
            name?: string | null
            commit_email?: string | null
            email?: string | null
            public_email?: string | null
        }
        if (typeof u?.username !== 'string' || !u.username) return null
        const login = u.username
        const host = new URL(base).host
        const email = u.commit_email || u.email || u.public_email || (u.id ? `${u.id}-${login}@users.noreply.${host}` : '')
        return { login, name: u.name?.trim() || login, email }
    } catch {
        return null
    }
}

export function cancelLogin(base: string) {
    pending.delete(base)
}
