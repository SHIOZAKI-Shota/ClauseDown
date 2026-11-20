import { GITLAB_APP } from '../shared/about'
import { deviceFlow, gitlabApi, gitlabWeb, oauthPost, oauthWhy, pollDeviceToken, type DeviceFlow } from './forge-http'
import { t } from '../shared/i18n'
import { GITLAB_BASE } from '../shared/forge'
import type { ForgeLogin } from '../shared/api'
import { credentialFromResponse, loadSettings, saveCredential, type Profile } from './settings'

const SCOPE = 'api read_repository write_repository'

export async function clientIdFor(base: string): Promise<string | null> {
    if (process.env.CLAUSEDOWN_GITLAB_CLIENT_ID) return process.env.CLAUSEDOWN_GITLAB_CLIENT_ID
    const s = await loadSettings()
    if (base === GITLAB_BASE) return s.gitlabClientId || GITLAB_APP.clientId || null
    return s.gitlabHosts?.find((h) => h.url === base)?.clientId || null
}

const post = async (base: string, path: string, body: Record<string, string>) => (await oauthPost(gitlabWeb(base) + path, body, true)).json

const pending = new Map<string, DeviceFlow>()

export async function startLogin(base: string): Promise<ForgeLogin> {
    const id = await clientIdFor(base)
    if (!id) throw new Error(t().errors.gitlabAuth.noAppId)
    const j = await post(base, '/oauth/authorize_device', { client_id: id, scope: SCOPE })
    if (!j.device_code) throw new Error(t().errors.gitlabAuth.cannotLoginOld(oauthWhy(j)))
    pending.set(base, deviceFlow(j, id, 300))
    const pick = [j.verification_uri_complete, j.verification_uri].map(String).find((u) => u.startsWith(gitlabWeb(base) + '/'))
    return {
        userCode: String(j.user_code),
        verificationUri: pick ?? `${base}/oauth/device`,
        expiresIn: Number(j.expires_in ?? 300),
    }
}

export async function waitLogin(base: string): Promise<string | null> {
    const p = pending.get(base)
    if (!p) throw new Error(t().errors.gitlabAuth.pressLoginFirst)
    try {
        const j = await pollDeviceToken(p, {
            request: () =>
                post(base, '/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: p.deviceCode, client_id: p.clientId }),
            alive: () => pending.get(base) === p,
            errors: { denied: t().errors.gitlabAuth.denied, expired: t().errors.gitlabAuth.expired, failed: t().errors.gitlabAuth.cannotLogin },
        })
        const who = await whoAmI(base, String(j.access_token))
        await saveCredential(base, credentialFromResponse(j, 'gitlab', p.clientId, who))
        return who?.login ?? null
    } finally {
        if (pending.get(base) === p) pending.delete(base)
    }
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
