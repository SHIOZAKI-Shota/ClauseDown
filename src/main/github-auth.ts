import { GITHUB_APP } from '../shared/about'
import { deviceFlow, githubApi, githubWeb, oauthPost, oauthWhy, pollDeviceToken, type DeviceFlow } from './forge-http'
import { t } from '../shared/i18n'
import { GITHUB_BASE, type ForgeLoginMethod } from '../shared/forge'
import type { ForgeLogin } from '../shared/api'

export interface GitHubAccount {
    login: string | null
    method: ForgeLoginMethod | null
}
import { credentialFromResponse, loadCredential, loadSettings, saveCredential, type Profile } from './settings'

export const BUILTIN_CLIENT_ID = GITHUB_APP.clientId

export async function clientId(): Promise<string> {
    const id = process.env.CLAUSEDOWN_GITHUB_CLIENT_ID || (await loadSettings()).githubClientId || BUILTIN_CLIENT_ID
    if (!id) throw new Error(t().errors.githubAuth.noClientId)
    return id
}

let pending: DeviceFlow | null = null

export async function startLogin(): Promise<ForgeLogin> {
    const id = await clientId()
    const { json: j } = await oauthPost(githubWeb() + '/login/device/code', { client_id: id }, false)
    if (!j.device_code) throw new Error(t().errors.githubAuth.cannotLogin(oauthWhy(j)))
    pending = deviceFlow(j, id, 900)
    return { userCode: String(j.user_code), verificationUri: String(j.verification_uri), expiresIn: Number(j.expires_in ?? 900) }
}

export async function waitLogin(): Promise<GitHubAccount> {
    if (!pending) throw new Error(t().errors.githubAuth.pressLoginFirst)
    const p = pending
    try {
        const j = await pollDeviceToken(p, {
            request: async () =>
                (
                    await oauthPost(
                        githubWeb() + '/login/oauth/access_token',
                        { client_id: p.clientId, device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
                        false,
                    )
                ).json,
            alive: () => pending === p,
            errors: { denied: t().errors.githubAuth.denied, expired: t().errors.githubAuth.expired, failed: t().errors.githubAuth.cannotLogin },
        })
        const who = await whoAmI(String(j.access_token))
        await saveCredential(GITHUB_BASE, credentialFromResponse(j, 'github', p.clientId, who))
        return { login: who?.login ?? null, method: 'app' }
    } finally {
        if (pending === p) pending = null
    }
}

export async function whoAmI(token: string): Promise<Profile | null> {
    const get = (path: string) => fetch(githubApi() + path, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } })
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
    return { login: c.login ?? (c.method === 'token' ? t().errors.githubAuth.tokenLogin : null), method: c.method }
}

export async function logout(): Promise<void> {
    pending = null
    await saveCredential(GITHUB_BASE, null)
}
