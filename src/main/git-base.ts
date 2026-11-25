import fs from 'node:fs'
import { isLoopbackHost } from '../shared/net'
import { t } from '../shared/i18n'
import type { AuthCallback } from 'isomorphic-git'
import git from './igit'
import { getToken, listCredentials, loadSettings } from './settings'
import { baseLabel, knownBases, underBase, type ForgeBase, type GitLabHost } from '../shared/forge'
import type { Identity } from '../shared/api'

export function safeRemoteUrl(url: string): boolean {
    try {
        const u = new URL(url.trim())
        return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname))
    } catch {
        return false
    }
}

export function tokenBaseFor(url: string, settings: { gitlabHosts?: GitLabHost[] }): ForgeBase | null {
    let u: URL
    try {
        u = new URL(url)
    } catch {
        return null
    }
    const bases = knownBases(settings)
    if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) {
        const base = process.env.CLAUSEDOWN_LOOPBACK_BASE
        return base ? (bases.find((b) => b.base === base) ?? null) : null
    }
    if (u.protocol !== 'https:') return null
    const clean = `https://${u.host.toLowerCase()}${u.pathname}`
    return [...bases].sort((a, b) => b.base.length - a.base.length).find((b) => underBase(clean, b.base)) ?? null
}

export const onAuth: AuthCallback = async (url) => {
    const settings = await loadSettings()
    const b = tokenBaseFor(url, settings)
    if (!b) return { cancel: true }
    const token = await getToken(b.base)
    if (!token) return { cancel: true }
    if (b.kind === 'gitlab') return { username: 'oauth2', password: token }
    return { username: settings.username || 'x-access-token', password: token }
}

export async function identity(dir?: string | null): Promise<Identity | null> {
    const settings = await loadSettings()
    const creds = await Promise.resolve()
        .then(() => listCredentials())
        .catch((): Awaited<ReturnType<typeof listCredentials>> => ({}))
    const bases = knownBases(settings)
    const fromLogin = (base: string): Identity | null => {
        const b = bases.find((x) => x.base === base)
        const c = creds[base]
        if (!b || !c?.name) return null
        return { name: c.name, email: c.email ?? '', login: c.login, source: b.kind, base, label: t().notify.identity.login(baseLabel(b), c.login ?? c.name) }
    }
    const anyLogin = () => bases.map((b) => fromLogin(b.base)).find(Boolean) ?? null
    const name = settings.author?.name?.trim()
    const manual = (): Identity | null =>
        name ? { name, email: settings.author.email?.trim() ?? '', source: 'manual', label: t().notify.identity.manual } : null
    const def = settings.identityDefault

    if (def === 'manual' && name) return manual()
    if (dir) {
        const url = await remoteUrl(dir).catch(() => null)
        const b = url ? tokenBaseFor(url, settings) : null
        const hit = b ? fromLogin(b.base) : null
        if (hit) return hit
    }
    if (def && def !== 'manual') {
        const hit = fromLogin(def)
        if (hit) return hit
    }
    if (!def) {
        const hit = anyLogin()
        if (hit) return hit
    }
    return manual() ?? (def ? anyLogin() : null)
}

export async function author(dir?: string | null): Promise<{ name: string; email: string }> {
    const who = await identity(dir)
    if (!who) throw new Error(t().errors.gitBase.noAuthor)
    return { name: who.name, email: who.email }
}

export const hasHead = (dir: string) =>
    git.resolveRef({ fs, dir, ref: 'HEAD' }).then(
        () => true,
        () => false,
    )
export const tryResolve = (dir: string, ref: string) => git.resolveRef({ fs, dir, ref }).catch(() => null)

export async function hasRemote(dir: string) {
    return (await git.listRemotes({ fs, dir })).some((r) => r.remote === 'origin')
}

export async function remoteUrl(dir: string): Promise<string | null> {
    return (await git.listRemotes({ fs, dir })).find((r) => r.remote === 'origin')?.url ?? null
}

export function explain(e: unknown): string {
    const err = e as { code?: string; message?: string; data?: { statusCode?: number } }
    if (err.code === 'UserCanceledError') {
        return t().errors.gitBase.notLoggedIn
    }
    if (err.data?.statusCode === 404) {
        return t().errors.gitBase.remoteNotFound
    }
    if (err.data?.statusCode === 401 || err.data?.statusCode === 403) return t().errors.gitBase.badToken
    if (err.code === 'PushRejectedError') return t().errors.gitBase.pushRejected
    if (err.code === 'HttpError') return t().errors.gitBase.http(String(err.message))
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(String(err.message))) return t().errors.gitBase.offline
    return err.message ?? String(e)
}

export const RECORDS_BRANCH = 'clausedown-records'
