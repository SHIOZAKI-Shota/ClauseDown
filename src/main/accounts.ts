import { baseLabel, knownBases, normalizeBase, type ForgeBase } from '../shared/forge'
import type { ForgeAccount, ForgeLogin } from '../shared/api'
import * as ghAuth from './github-auth'
import * as glAuth from './gitlab-auth'
import { getToken, listCredentials, loadSettings, saveCredential, setToken as saveToken, type Credential, type Profile } from './settings'

export async function knownBase(raw: unknown): Promise<ForgeBase> {
    const base = normalizeBase(raw)
    const hit = base && knownBases(await loadSettings()).find((b) => b.base === base)
    if (!hit) throw new Error('登録されていないサーバーです')
    return hit
}

function whoAmI(b: ForgeBase, token: string): Promise<Profile | null> {
    return b.kind === 'github' ? ghAuth.whoAmI(token) : glAuth.whoAmI(b.base, token)
}

const profileTried = new Set<string>()
async function fillProfile(b: ForgeBase, c: Credential): Promise<Credential> {
    if (c.name || profileTried.has(b.base)) return c
    profileTried.add(b.base)
    const token = await getToken(b.base).catch(() => null)
    const who = token ? await whoAmI(b, token) : null
    if (!who) return c

    const latest = (await listCredentials())[b.base]
    if (!latest) return c
    const next = { ...latest, ...who }
    await saveCredential(b.base, next)
    return next
}

export async function accounts(): Promise<ForgeAccount[]> {
    const [settings, creds] = await Promise.all([loadSettings(), listCredentials()])
    const out: ForgeAccount[] = []
    for (const b of knownBases(settings)) {
        const c = creds[b.base] ? await fillProfile(b, creds[b.base]) : undefined
        out.push({
            ...b,
            label: baseLabel(b),
            login: c ? (c.login ?? (c.method === 'token' ? '（トークン）' : null)) : null,
            name: c?.name ?? null,
            email: c?.email ?? null,
            method: c?.method ?? null,
            deviceLogin: b.kind === 'github' || !!(await glAuth.clientIdFor(b.base)),
        })
    }
    return out
}

async function accountOf(base: string): Promise<ForgeAccount> {
    return (await accounts()).find((a) => a.base === base)!
}

export async function loginStart(raw: unknown): Promise<ForgeLogin> {
    const b = await knownBase(raw)
    return b.kind === 'github' ? ghAuth.startLogin() : glAuth.startLogin(b.base)
}

export async function loginWait(raw: unknown): Promise<ForgeAccount> {
    const b = await knownBase(raw)
    if (b.kind === 'github') await ghAuth.waitLogin()
    else await glAuth.waitLogin(b.base)
    return accountOf(b.base)
}

export async function logout(raw: unknown): Promise<void> {
    const b = await knownBase(raw)
    profileTried.delete(b.base)
    if (b.kind === 'github') await ghAuth.logout()
    else {
        glAuth.cancelLogin(b.base)
        await saveCredential(b.base, null)
    }
}

export async function setToken(raw: unknown, token: unknown): Promise<void> {
    const b = await knownBase(raw)
    const t = typeof token === 'string' ? token.trim() : ''
    await saveToken(b.base, t, b.kind)
    if (!t) return
    profileTried.add(b.base)
    const who = await whoAmI(b, t)
    if (!who && b.kind === 'gitlab') {
        await saveCredential(b.base, null)
        throw new Error('このトークンでは GitLab にログインできませんでした。トークンと、scope（api・read_repository・write_repository）を確かめてください')
    }
    if (who) await saveCredential(b.base, { provider: b.kind, method: 'token', access: t, ...who })
}

export async function hasToken(): Promise<boolean> {
    return Object.keys(await listCredentials()).length > 0
}
