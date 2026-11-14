import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '../shared/api'
import { cleanGitLabHosts, GITHUB_BASE, type ForgeKind } from '../shared/forge'
import { cleanAiConfig } from '../shared/ai-providers'
import { isEnabled } from '../shared/experiments'
import { cleanStyle, DEFAULT_PREFS } from '../shared/prefs'
import { writeAtomic } from './atomic'

const settingsPath = () => join(app.getPath('userData'), 'settings.json')
const tokenPath = () => join(app.getPath('userData'), 'token.bin')

const DEFAULT: AppSettings = { repos: [], author: { name: '', email: '' }, username: 'x-access-token', prefs: DEFAULT_PREFS }

function normalize(saved: Partial<AppSettings>): AppSettings {
    const prefs = { ...DEFAULT_PREFS, ...saved.prefs }
    return {
        ...DEFAULT,
        ...saved,
        gitlabHosts: cleanGitLabHosts(saved.gitlabHosts),
        ai: cleanAiConfig(saved.ai, { lan: isEnabled(saved, 'lanAi') }),
        prefs: { ...prefs, docStyle: cleanStyle(prefs.docStyle) },
    } as AppSettings
}

async function readJson(path: string): Promise<Partial<AppSettings> | null> {
    try {
        return JSON.parse(await fs.readFile(path, 'utf8'))
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
    }
}

let cached: AppSettings | null = null

async function readSettings(): Promise<AppSettings> {
    const path = settingsPath()
    try {
        return normalize((await readJson(path)) ?? {})
    } catch (e) {
        console.error('[settings] 設定を読めませんでした', e)
        const bak = await readJson(`${path}.bak`).catch(() => null)
        if (bak) return normalize(bak)
        await fs.rename(path, `${path}.broken-${Date.now()}`).catch(() => {})
        return structuredClone(DEFAULT)
    }
}

export async function loadSettings(): Promise<AppSettings> {
    cached ??= await readSettings()
    return structuredClone(cached)
}

export async function saveSettings(s: AppSettings): Promise<void> {
    const next = normalize(s)
    const path = settingsPath()
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.copyFile(path, `${path}.bak`).catch(() => {})
    await writeAtomic(path, JSON.stringify(next, null, 2))
    cached = next
}

let settingsQueue: Promise<unknown> = Promise.resolve()

export function updateSettings(fn: (s: AppSettings) => AppSettings | Promise<AppSettings>): Promise<void> {
    const next = settingsQueue.then(async () => saveSettings(await fn(await loadSettings())))
    settingsQueue = next.catch(() => {})
    return next
}

export function forgetCachedSettings() {
    cached = null
}

export interface Credential {
    provider?: ForgeKind
    method: 'token' | 'app'
    access: string
    refresh?: string
    expiresAt?: number
    refreshExpiresAt?: number
    login?: string
    name?: string
    email?: string
    clientId?: string
}

export interface Profile {
    login: string
    name: string
    email: string
}

interface Store {
    v: 2
    hosts: Record<string, Credential>
}

async function loadStore(): Promise<Store> {
    let raw: string
    try {
        raw = safeStorage.decryptString(await fs.readFile(tokenPath()))
    } catch {
        return { v: 2, hosts: {} }
    }
    let j: unknown
    try {
        j = JSON.parse(raw)
    } catch {
        return raw ? { v: 2, hosts: { [GITHUB_BASE]: { provider: 'github', method: 'token', access: raw } } } : { v: 2, hosts: {} }
    }
    const o = j as Partial<Store> & Partial<Credential>
    if (o.v === 2 && o.hosts && typeof o.hosts === 'object') return { v: 2, hosts: o.hosts }
    if (typeof o.access === 'string') return { v: 2, hosts: { [GITHUB_BASE]: { ...(o as Credential), provider: 'github' } } }
    return { v: 2, hosts: {} }
}

async function saveStore(s: Store): Promise<void> {
    if (!Object.keys(s.hosts).length) {
        await fs.rm(tokenPath(), { force: true })
        return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('ローカル では認証情報を暗号化して保存できません')
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(tokenPath(), safeStorage.encryptString(JSON.stringify(s)))
}

let storeQueue: Promise<unknown> = Promise.resolve()
function updateStore(fn: (s: Store) => void): Promise<void> {
    const next = storeQueue.then(async () => {
        const s = await loadStore()
        fn(s)
        await saveStore(s)
    })
    storeQueue = next.catch(() => {})
    return next
}

export async function saveCredential(base: string, c: Credential | null): Promise<void> {
    await updateStore((s) => {
        if (c) s.hosts[base] = c
        else delete s.hosts[base]
    })
}

export async function loadCredential(base: string = GITHUB_BASE): Promise<Credential | null> {
    return (await loadStore()).hosts[base] ?? null
}

export async function listCredentials(): Promise<Record<string, Credential>> {
    return (await loadStore()).hosts
}

export async function setToken(base: string, token: string, provider: ForgeKind): Promise<void> {
    await saveCredential(base, token ? { provider, method: 'token', access: token } : null)
}

const githubWeb = () => process.env.CLAUSEDOWN_GITHUB_WEB ?? GITHUB_BASE
export const gitlabWeb = (base: string) => process.env.CLAUSEDOWN_GITLAB_WEB ?? base

async function refresh(base: string, c: Credential): Promise<Credential | null> {
    if (!c.refresh || !c.clientId) return null
    if (c.refreshExpiresAt && c.refreshExpiresAt < Date.now()) return null
    const gitlab = c.provider === 'gitlab'
    const url = gitlab ? `${gitlabWeb(base)}/oauth/token` : `${githubWeb()}/login/oauth/access_token`
    const body = { client_id: c.clientId, grant_type: 'refresh_token', refresh_token: c.refresh }
    const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': gitlab ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: gitlab ? new URLSearchParams(body).toString() : JSON.stringify(body),
    })
    const j = (await res.json().catch(() => ({}))) as OAuthResponse
    if (!res.ok || !j.access_token) return null
    const next = credentialFromResponse(j, c.provider ?? 'github', c.clientId, c)
    await saveCredential(base, next)
    return next
}

// OAuth の応答（JSON）。値は文字列か数値
export type OAuthResponse = Record<string, string | number | undefined>

export function credentialFromResponse(
    j: OAuthResponse,
    provider: ForgeKind,
    clientId: string,
    who?: { login?: string; name?: string; email?: string } | null,
): Credential {
    const now = Date.now()
    return {
        provider,
        method: 'app',
        access: String(j.access_token),
        refresh: j.refresh_token ? String(j.refresh_token) : undefined,
        expiresAt: j.expires_in ? now + Number(j.expires_in) * 1000 : undefined,
        refreshExpiresAt: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : undefined,
        login: who?.login,
        name: who?.name,
        email: who?.email,
        clientId,
    }
}

export type SecretName = 'ai-key' | 'mcp-token' | `ai-key-${string}`

const secretPath = (name: SecretName) => {
    if (!/^(ai-key|mcp-token|ai-key-[a-z0-9-]{1,80})$/.test(name)) throw new Error('不正な名前です')
    return join(app.getPath('userData'), `${name}.bin`)
}

export async function saveSecret(name: SecretName, value: string): Promise<void> {
    if (!value) {
        await fs.rm(secretPath(name), { force: true })
        return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('ローカル では API キーなどを暗号化して保存できません')
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(secretPath(name), safeStorage.encryptString(value))
}

const OWN_FILE = /^(settings\.json(\.bak|\.broken-\d+)?|notified\.json|token\.bin|(ai-key|mcp-token)(-[a-z0-9-]+)?\.bin)$/

export async function resetAllData(): Promise<void> {
    const dir = app.getPath('userData')
    const names = await fs.readdir(dir).catch(() => [] as string[])
    await Promise.all(names.filter((n) => OWN_FILE.test(n)).map((n) => fs.rm(join(dir, n), { force: true })))
}

export async function loadSecret(name: SecretName): Promise<string | null> {
    try {
        return safeStorage.decryptString(await fs.readFile(secretPath(name))) || null
    } catch {
        return null
    }
}

const refreshing = new Map<string, Promise<Credential | null>>()

export async function getToken(base: string = GITHUB_BASE): Promise<string | null> {
    const c = await loadCredential(base)
    if (!c) return null
    if (c.method === 'app' && c.expiresAt && c.expiresAt - Date.now() < 5 * 60 * 1000) {
        let p = refreshing.get(base)
        if (!p) {
            p = refresh(base, c).finally(() => refreshing.delete(base))
            refreshing.set(base, p)
        }
        return (await p)?.access ?? null
    }
    return c.access
}
