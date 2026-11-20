import fs from 'node:fs'
import { GITHUB_BASE, knownBases, matchRemote } from '../shared/forge'
import type { KeyRegistration } from '../shared/api'
import type { ReviewEvent } from '../shared/review'
import type { SigInfo } from '../shared/signing'
import git from './igit'
import { remoteUrl } from './git-base'
import * as gh from './github'
import * as gl from './gitlab'
import { RECORD, readRecords } from './records'
import { loadCredential, loadSettings, updateSettings } from './settings'
import { signingSettings } from './signing'
import { blobOfPublicKey, commitPayload, fingerprintOf, sshVerify, NS_GIT } from './ssh-sig'
import { getRules } from './workflow'
import { loadPolicy } from './policy'

export interface SignerEntry {
    name?: string
    login?: string
    publicKey: string
    source: 'own' | 'forge' | 'repo' | 'policy'
}

const isGitHub = (base: string) => base === GITHUB_BASE

export async function registerSigningKey(base: string): Promise<KeyRegistration> {
    const s = await signingSettings()
    const key = s.commit.key
    if (!key) throw new Error('no key')
    const manualUrl = isGitHub(base) ? 'https://github.com/settings/ssh/new' : `${base.replace(/\/$/, '')}/-/user_settings/ssh_keys`
    const title = `ClauseDown (${new Date().toISOString().slice(0, 10)})`
    try {
        if (isGitHub(base)) await gh.addSigningKey(title, key.publicKey)
        else await gl.addSigningKey(base, title, key.publicKey)
    } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 422 || (status === 400 && /taken|already/i.test((e as Error).message))) return markRegistered(base)
        if (status === 401 || status === 403 || status === 404) return { ok: false, manualUrl }
        throw e
    }
    return markRegistered(base)
}

async function markRegistered(base: string, manual = false): Promise<KeyRegistration> {
    await updateSettings((st) => {
        if (!st.signing) return st
        const registered = { ...st.signing.commit.registered, [base]: { at: new Date().toISOString(), manual: manual || undefined } }
        return { ...st, signing: { ...st.signing, commit: { ...st.signing.commit, registered } } }
    })
    return { ok: true }
}

const keyCache = new Map<string, { at: number; keys: string[] }>()
const TTL = 10 * 60 * 1000

async function forgeKeys(base: string, login: string): Promise<string[]> {
    const id = `${base}|${login.toLowerCase()}`
    const hit = keyCache.get(id)
    if (hit && Date.now() - hit.at < TTL) return hit.keys
    let keys: string[] = []
    try {
        keys = isGitHub(base) ? await gh.signingKeysOf(login) : await gl.signingKeysOf(base, login)
    } catch {
        keys = hit?.keys ?? []
    }
    keyCache.set(id, { at: Date.now(), keys })
    return keys
}

function loginFromEmail(email: string): string | null {
    const m = /^\d+[+-]([A-Za-z0-9][A-Za-z0-9-]*)@users\.noreply\./.exec(email)
    return m ? m[1] : null
}

export async function keyring(dir: string, emails: string[] = []): Promise<Map<string, SignerEntry>> {
    const ring = new Map<string, SignerEntry>()
    const add = (entry: SignerEntry) => {
        const blob = blobOfPublicKey(entry.publicKey)
        if (!blob) return
        const fp = fingerprintOf(blob)
        const rank = { policy: 3, forge: 2, own: 1, repo: 0 }
        const cur = ring.get(fp)
        if (!cur || rank[entry.source] > rank[cur.source]) ring.set(fp, entry)
    }
    const settings = await loadSettings()
    const own = settings.signing?.commit.key
    if (own) add({ publicKey: own.publicKey, name: settings.author.name || undefined, source: 'own' })
    const policy = (await loadPolicy(dir).catch(() => null))?.doc
    for (const p of [...(policy?.approvers ?? []), ...(policy?.admins ?? [])])
        for (const k of p.keys) add({ publicKey: k.publicKey, name: p.name, login: p.login, source: 'policy' })
    for (const s of await readRecords<SignerEntry & { publicKey: string }>(dir, RECORD.signers).catch(() => [])) {
        if (typeof s?.publicKey === 'string') add({ publicKey: s.publicKey, name: s.name, login: s.login, source: 'repo' })
    }
    const m = matchRemote(await remoteUrl(dir).catch(() => ''), knownBases(settings))
    if (m) {
        const logins = new Set<string>()
        const me = (await loadCredential(m.base))?.login
        if (me) logins.add(me)
        for (const e of emails) {
            const l = loginFromEmail(e)
            if (l) logins.add(l)
        }
        for (const a of (await getRules(dir).catch(() => ({ approvers: [] as string[] }))).approvers) if (a.startsWith('@')) logins.add(a.slice(1))
        for (const r of await readRecords<ReviewEvent>(dir, RECORD.reviews).catch(() => [])) {
            const l = r?.byLogin ?? r?.forgeUser
            if (typeof l === 'string' && l) logins.add(l)
        }
        for (const login of [...logins].slice(0, 30)) {
            for (const k of await forgeKeys(m.base, login)) add({ publicKey: k, login, source: 'forge' })
        }
    }
    return ring
}

function infoOf(signature: string | null, payload: string, ring: Map<string, SignerEntry>): SigInfo {
    if (!signature) return { state: 'none' }
    if (signature.includes('BEGIN PGP SIGNATURE')) return { state: 'pgp' }
    const r = sshVerify(signature, payload, NS_GIT)
    if (!r.ok) return { state: 'bad', fingerprint: r.fingerprint }
    const who = r.fingerprint ? ring.get(r.fingerprint) : undefined
    if (!who) return { state: 'unknown-key', fingerprint: r.fingerprint }
    return { state: 'verified', fingerprint: r.fingerprint, signer: { login: who.login, name: who.name, source: who.source } }
}

export async function verifyCommits(dir: string, oids: string[]): Promise<Record<string, SigInfo>> {
    const out: Record<string, SigInfo> = {}
    const raws: { oid: string; raw: string; email: string }[] = []
    for (const oid of oids.filter((o) => /^[0-9a-f]{40}$/.test(o)).slice(0, 300)) {
        try {
            const { object } = await git.readObject({ fs, dir, oid, format: 'content' })
            const raw = new TextDecoder().decode(object as Uint8Array)
            const email = /^author .* <([^>]*)>/m.exec(raw)?.[1] ?? ''
            raws.push({ oid, raw, email })
        } catch {
            out[oid] = { state: 'none' }
        }
    }
    const ring = await keyring(
        dir,
        raws.map((r) => r.email),
    )
    for (const { oid, raw } of raws) {
        const { payload, signature } = commitPayload(raw)
        out[oid] = infoOf(signature, payload, ring)
    }
    return out
}

export async function forgePublicKeys(dir: string, login: string): Promise<string[]> {
    const m = matchRemote(await remoteUrl(dir).catch(() => ''), knownBases(await loadSettings()))
    if (!m || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(login)) return []
    return forgeKeys(m.base, login)
}

const sshTime = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}
const principal = (v: string) => v.trim().replace(/[\s,"*?!]+/g, '_') || 'unknown'

export async function allowedSigners(dir: string): Promise<string> {
    const settings = await loadSettings()
    const m = matchRemote(await remoteUrl(dir).catch(() => ''), knownBases(settings))
    const host = m ? new URL(m.base).host : ''
    const lines = new Map<string, string>()
    const add = (who: string, publicKey: string, validFrom?: string, validUntil?: string) => {
        const key = publicKey.trim().split(/\s+/).slice(0, 2).join(' ')
        if (!blobOfPublicKey(key)) return
        const opts = ['namespaces="git"']
        if (validFrom) opts.push(`valid-after="${sshTime(validFrom)}"`)
        if (validUntil) opts.push(`valid-before="${sshTime(validUntil)}"`)
        const line = `${principal(who)} ${opts.join(',')} ${key}`
        lines.set(`${principal(who)} ${key} ${validFrom ?? ''}`, line)
    }
    const policy = (await loadPolicy(dir).catch(() => null))?.doc
    for (const p of [...(policy?.approvers ?? []), ...(policy?.admins ?? [])])
        for (const k of p.keys) add(p.login ?? p.name, k.publicKey, k.validFrom, k.validUntil)
    for (const [, e] of await keyring(dir)) {
        if (e.source === 'policy') continue
        const who =
            e.source === 'own' ? settings.author.email || e.name || 'me' : e.source === 'forge' && e.login ? `${e.login}@${host}` : (e.login ?? e.name ?? '')
        add(who, e.publicKey)
    }
    return [...lines.values()].join('\n') + '\n'
}

export async function exportAllowedSigners(parent: Electron.BrowserWindow | null, dir: string): Promise<string | null> {
    const { dialog } = await import('electron')
    const opts = { defaultPath: 'allowed_signers' }
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await fs.promises.writeFile(r.filePath, await allowedSigners(dir), 'utf8')
    return r.filePath
}
