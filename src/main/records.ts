import fs from 'node:fs'
import git from './igit'
import http from 'isomorphic-git/http/node'
import { withRepoLock } from './repo-lock'
import { author, hasRemote, onAuth, RECORDS_BRANCH, tryResolve } from './git-base'

const LOCAL = `refs/heads/${RECORDS_BRANCH}`
const REMOTE = `refs/remotes/origin/${RECORDS_BRANCH}`

export const RECORD = {
    reviews: 'reviews/',
    deliveries: 'deliveries/',
    events: 'events/',
    rules: 'settings/rules.json',
    eventKinds: 'settings/event-kinds.json',
    issues: 'issues/',
    issueLinks: 'issue-links/',
    issueComments: 'issue-comments/',
} as const

async function filesOf(dir: string, oid: string | null, into = new Map<string, string>(), prefix = '') {
    if (!oid) return into
    const { tree } = await git.readTree({ fs, dir, oid })
    for (const e of tree) {
        if (e.type === 'blob') into.set(prefix + e.path, e.oid)
        else if (e.type === 'tree') await filesOf(dir, e.oid, into, `${prefix}${e.path}/`)
    }
    return into
}

async function writeTreeOf(dir: string, entries: [string, string][]): Promise<string> {
    type Entry = { mode: string; path: string; oid: string; type: 'blob' | 'tree' }
    const out: Entry[] = []
    const subs = new Map<string, [string, string][]>()
    for (const [path, oid] of entries) {
        const i = path.indexOf('/')
        if (i < 0) out.push({ mode: '100644', path, oid, type: 'blob' })
        else subs.set(path.slice(0, i), [...(subs.get(path.slice(0, i)) ?? []), [path.slice(i + 1), oid]])
    }
    for (const [name, list] of subs) out.push({ mode: '040000', path: name, oid: await writeTreeOf(dir, list), type: 'tree' })
    const key = (e: Entry) => (e.type === 'tree' ? `${e.path}/` : e.path)
    out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    return git.writeTree({ fs, dir, tree: out })
}

const mergedMemo = new Map<string, { key: string; files: Map<string, string> }>()

async function mergedFiles(dir: string) {
    const local = await tryResolve(dir, LOCAL)
    const remote = await tryResolve(dir, REMOTE)
    const key = `${local}|${remote}`
    const hit = mergedMemo.get(dir)
    if (hit?.key === key) return { local, remote, files: new Map(hit.files) }
    const l = await filesOf(dir, local)
    const r = await filesOf(dir, remote)
    let base = new Map<string, string>()
    if (local && remote && local !== remote) {
        const b = (await git.findMergeBase({ fs, dir, oids: [local, remote] }))[0] as string | undefined
        base = await filesOf(dir, b ?? null)
    }
    const files = new Map(r)
    for (const [name, oid] of l) {
        if (r.has(name) && base.get(name) === oid) continue
        files.set(name, oid)
    }
    mergedMemo.set(dir, { key, files: new Map(files) })
    return { local, remote, files }
}

async function parentsOf(dir: string, local: string | null, remote: string | null): Promise<string[]> {
    if (!local) return remote ? [remote] : []
    if (!remote || local === remote) return [local]
    if (await git.isDescendent({ fs, dir, oid: local, ancestor: remote, depth: -1 })) return [local]
    if (await git.isDescendent({ fs, dir, oid: remote, ancestor: local, depth: -1 })) return [remote]
    return [local, remote]
}

async function commitFiles(dir: string, files: Map<string, string>, parents: string[], message: string) {
    const tree = await writeTreeOf(dir, [...files.entries()])
    const who = await author(dir)
    const sig = { ...who, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: new Date().getTimezoneOffset() }
    const oid = await git.writeCommit({ fs, dir, commit: { message, tree, parent: parents, author: sig, committer: sig } })
    await git.writeRef({ fs, dir, ref: LOCAL, value: oid, force: true })
    return oid
}

const jsonMemo = new Map<string, unknown>()
async function readJson(dir: string, oid: string): Promise<unknown> {
    if (!jsonMemo.has(oid)) {
        if (jsonMemo.size > 5000) jsonMemo.clear()
        let v: unknown = null
        try {
            v = JSON.parse(new TextDecoder().decode((await git.readBlob({ fs, dir, oid })).blob))
        } catch {}
        jsonMemo.set(oid, v)
    }
    const v = jsonMemo.get(oid)
    return v === null ? null : structuredClone(v)
}

export async function readRecords<T = unknown>(dir: string, prefix = ''): Promise<T[]> {
    const { files } = await mergedFiles(dir)
    const oids = [...files].filter(([path]) => path.startsWith(prefix) && path.endsWith('.json')).map(([, oid]) => oid)
    const all = await Promise.all(oids.map((oid) => readJson(dir, oid)))
    return all.filter((v) => v !== null && typeof v === 'object') as T[]
}

export async function readRecord<T>(dir: string, name: string): Promise<T | null> {
    const { files } = await mergedFiles(dir)
    const oid = files.get(name)
    return oid ? ((await readJson(dir, oid)) as T | null) : null
}

export async function writeRecord(dir: string, name: string, data: unknown): Promise<void> {
    if (!/^[\w./-]+\.json$/.test(name) || name.split('/').some((p) => !p || p === '.' || p === '..')) throw new Error(`記録の名前が正しくありません: ${name}`)
    await withRepoLock(dir, async () => {
        const { local, remote, files } = await mergedFiles(dir)
        const blob = await git.writeBlob({ fs, dir, blob: Buffer.from(JSON.stringify(data, null, 2), 'utf8') })
        files.set(name, blob)
        await commitFiles(dir, files, await parentsOf(dir, local, remote), `記録: ${name}`)
    })
    await withRepoLock(dir, () => pushRecords(dir)).catch((e) => console.error('[records] 記録を送信できませんでした。次の同期で送ります', e))
}

export const newId = () =>
    `${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`

export async function pushRecords(dir: string): Promise<void> {
    if (!(await hasRemote(dir))) return
    let local = await tryResolve(dir, LOCAL)
    if (!local) return
    const remote = await tryResolve(dir, REMOTE)
    if (local === remote) return
    const parents = await parentsOf(dir, local, remote)
    if (parents.length === 2) {
        const { files } = await mergedFiles(dir)
        local = await commitFiles(dir, files, parents, '記録を統合')
    } else if (parents[0] !== local) {
        await git.writeRef({ fs, dir, ref: LOCAL, value: parents[0], force: true })
        return
    }
    const res = await git.push({ fs, http, dir, remote: 'origin', ref: RECORDS_BRANCH, onAuth })
    if (!res.ok) throw new Error('記録を送信できませんでした')
    await git.writeRef({ fs, dir, ref: REMOTE, value: local, force: true })
}
