import fs, { promises as fsp } from 'node:fs'
import git from './igit'
import { tryResolve } from './git-base'
import { commitFile, listDocs, readCommitCached, safeJoin } from './git'
import { repoKey } from './repo-lock'
import type { RepoActivity } from '../shared/api'
import { APP_DIR } from '../shared/folder-style'
import { dirname, join } from 'node:path'

const MAX_COMMITS = 500
const RECENT = 20

async function filesOf(dir: string, treeOid: string, cache: Map<string, Map<string, string>>): Promise<Map<string, string>> {
    const hit = cache.get(treeOid)
    if (hit) return hit
    const out = new Map<string, string>()
    const { tree } = await git.readTree({ fs, dir, oid: treeOid })
    for (const e of tree) {
        if (e.path.startsWith('.')) continue
        if (e.type === 'tree') {
            for (const [p, o] of await filesOf(dir, e.oid, cache)) out.set(`${e.path}/${p}`, o)
        } else if (e.type === 'blob' && e.path.toLowerCase().endsWith('.md')) {
            out.set(e.path, e.oid)
        }
    }
    cache.set(treeOid, out)
    return out
}

function changedBetween(a: Map<string, string>, b: Map<string, string>): string[] {
    const out = new Set<string>()
    for (const [p, o] of a) if (b.get(p) !== o) out.add(p)
    for (const p of b.keys()) if (!a.has(p)) out.add(p)
    return [...out].sort((x, y) => x.localeCompare(y, 'ja'))
}

const cleanMessage = (m: string) => m.replace(/\n+施行日: \S+\s*$/, '').trim()

const articleMemo = new Map<string, { mtime: number; n: number }>()
async function articleCount(full: string): Promise<number> {
    const st = await fsp.stat(full).catch(() => null)
    if (!st) return 0
    const hit = articleMemo.get(full)
    if (hit?.mtime === st.mtimeMs) return hit.n
    const n = ((await fsp.readFile(full, 'utf8').catch(() => '')).match(/^###\s/gm) ?? []).length
    if (articleMemo.size >= 5000) articleMemo.clear()
    articleMemo.set(full, { mtime: st.mtimeMs, n })
    return n
}

type History = { recent: RepoActivity['recent']; last: Record<string, { author: string; timestamp: number }> }
const historyMemo = new Map<string, { key: string; value: History }>()

async function history(dir: string, present: Set<string>): Promise<History> {
    const head = await tryResolve(dir, 'HEAD')
    const key = `${head}|${[...present].sort().join('\n')}`
    const hit = historyMemo.get(repoKey(dir))
    if (hit?.key === key) return hit.value
    const recent: RepoActivity['recent'] = []
    const last: History['last'] = {}
    const cache = new Map<string, Map<string, string>>()
    let oid = head
    let found = 0
    let next = oid ? await readCommitCached(dir, oid) : null
    for (let i = 0; oid && next && i < MAX_COMMITS; i++) {
        const commit = next
        const parent = commit.parent[0]
        const mine = await filesOf(dir, commit.tree, cache)
        next = parent ? await readCommitCached(dir, parent) : null
        const before = next ? await filesOf(dir, next.tree, cache) : new Map<string, string>()
        const paths = changedBetween(mine, before)
        const who = { author: commit.author.name, timestamp: commit.author.timestamp }
        if (recent.length < RECENT) recent.push({ oid, message: cleanMessage(commit.message), ...who, paths })
        for (const p of paths) {
            if (present.has(p) && !last[p]) {
                last[p] = who
                found++
            }
        }
        if (recent.length >= RECENT && found >= present.size) break
        oid = parent ?? null
    }
    const value = { recent, last }
    if (historyMemo.size >= 8) historyMemo.clear()
    historyMemo.set(repoKey(dir), { key, value })
    return value
}

export async function repoActivity(dir: string): Promise<RepoActivity> {
    const docs = await listDocs(dir)
    const present = new Set(docs.map((d) => d.path))
    const [counts, { recent, last }, effective] = await Promise.all([
        Promise.all(docs.map((d) => articleCount(join(dir, d.path)))),
        history(dir, present),
        allEffective(dir),
    ])
    const lastChange: RepoActivity['docs'] = {}
    docs.forEach((d, i) => (lastChange[d.path] = { articles: counts[i], ...last[d.path] }))
    return { recent: recent.map((r) => ({ ...r, paths: [...r.paths] })), docs: lastChange, effective }
}

const tagMemo = new Map<string, { oid: string; message: string }>()

export async function allEffective(dir: string): Promise<RepoActivity['effective']> {
    const out: RepoActivity['effective'] = []
    for (const tag of await git.listTags({ fs, dir })) {
        const m = /^施行\/(.+)\/(\d{4}-\d{2}-\d{2})$/.exec(tag)
        if (!m) continue
        const tagOid = await git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` })
        if (!tagMemo.has(tagOid)) {
            let oid = tagOid
            try {
                oid = (await git.readTag({ fs, dir, oid })).tag.object
            } catch {
            }
            const { commit } = await git.readCommit({ fs, dir, oid }).catch(() => ({ commit: null }))
            if (!commit) continue
            if (tagMemo.size > 5000) tagMemo.clear()
            tagMemo.set(tagOid, { oid, message: cleanMessage(commit.message) })
        }
        const hit = tagMemo.get(tagOid)
        if (!hit) continue
        out.push({ docPath: m[1] === 'all' ? '' : `${m[1]}.md`, date: m[2], ...hit })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
}

const NOTE = `${APP_DIR}/readme.md`

export async function readRepoNote(dir: string): Promise<string> {
    return fsp.readFile(safeJoin(dir, NOTE), 'utf8').catch(() => '')
}

export async function saveRepoNote(dir: string, text: unknown): Promise<boolean> {
    if (typeof text !== 'string') throw new Error('説明の内容が正しくありません')
    const full = safeJoin(dir, NOTE)
    if (text.trim()) {
        await fsp.mkdir(dirname(full), { recursive: true })
        await fsp.writeFile(full, text.replace(/\s+$/, '') + '\n', 'utf8')
    } else if (fs.existsSync(full)) await fsp.rm(full)
    else return false
    return commitFile(dir, NOTE, 'リポジトリの説明を更新')
}
