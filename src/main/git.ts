import fs, { promises as fsp } from 'node:fs'
import { join, relative, resolve, sep, dirname, basename } from 'node:path'
import { imageExt } from '../shared/images'
import git, { TREE, dropCache } from './igit'
import http from 'isomorphic-git/http/node'
import type { CommitObject, TreeEntry } from 'isomorphic-git'
import type { BranchInfo, ConflictChoice, CommitInfo, Conflict, DocFile, MergeInput, MergePreview, SaveVersionInput, SyncState } from '../shared/api'
import { author, explain, safeRemoteUrl, hasHead, hasRemote, onAuth, RECORDS_BRANCH, remoteUrl, tryResolve } from './git-base'
import { pushRecords } from './records'
import { autoMerge } from '../shared/merge3'
import { knownBases, matchRemote } from '../shared/forge'
import { newDocText } from '../shared/doc-preset'
import { loadSettings } from './settings'
import { repoKey, withRepoLock } from './repo-lock'
import { writeAtomic } from './atomic'

interface ObjMemo {
    commits: Map<string, CommitObject>
    trees: Map<string, Map<string, TreeEntry>>
    ancestors: Map<string, Set<string>>
    branches?: { key: string; list: BranchInfo[] }
    tags?: { key: string; map: Map<string, string[]> }
    analyzed: Map<string, Analysis>
}
const MAX_OBJ = 100_000
const memos = new Map<string, ObjMemo>()
function memoOf(dir: string): ObjMemo {
    const key = repoKey(dir)
    let m = memos.get(key)
    if (m) memos.delete(key)
    else m = { commits: new Map(), trees: new Map(), ancestors: new Map(), analyzed: new Map() }
    memos.set(key, m)
    while (memos.size > 4) memos.delete(memos.keys().next().value!)
    return m
}
function remember<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_OBJ) {
    if (map.size >= max) map.clear()
    map.set(key, value)
    return value
}

export function forgetRepo(dir: string) {
    memos.delete(repoKey(dir))
    dropCache(dir)
}

export async function readCommitCached(dir: string, oid: string): Promise<CommitObject> {
    const m = memoOf(dir).commits
    return m.get(oid) ?? remember(m, oid, (await git.readCommit({ fs, dir, oid })).commit)
}

async function treeOf(dir: string, oid: string): Promise<Map<string, TreeEntry>> {
    const m = memoOf(dir).trees
    const hit = m.get(oid)
    if (hit) return hit
    const { tree } = await git.readTree({ fs, dir, oid })
    return remember(m, oid, new Map(tree.map((e) => [e.path, e])), 20_000)
}

export function safeJoin(dir: string, path: string): string {
    const full = resolve(dir, path)
    const root = resolve(dir)
    if (full !== root && !full.startsWith(root + sep)) throw new Error(`不正なパスです: ${path}`)
    let cur = root
    for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
        cur = join(cur, part)
        const st = fs.lstatSync(cur, { throwIfNoEntry: false })
        if (!st) break
        if (st.isSymbolicLink()) throw new Error(`リンクになっている場所には書き込めません: ${path}`)
    }
    return full
}

const toPosix = (p: string) => p.split(sep).join('/')

async function ensureEmptyDir(dir: string) {
    if (fs.existsSync(join(dir, '.git'))) throw new Error('このフォルダはすでに版管理されています。「ローカル にあるフォルダを開く」を使ってください')
    const items = await fsp.readdir(dir).catch(() => null)
    if (items && items.length) throw new Error(`「${basename(dir)}」という名前のフォルダがすでにあり、中にファイルがあります。別の名前にしてください`)
}

export async function cloneRepo(url: string, dir: string): Promise<void> {
    if (!safeRemoteUrl(url)) throw new Error('リモートの URL は https:// で始まるものを入力してください')
    await ensureEmptyDir(dir)
    const created = !fs.existsSync(dir)
    await fsp.mkdir(dir, { recursive: true })
    try {
        await git.clone({ fs, http, dir, url, onAuth, singleBranch: false })
    } catch (e) {
        forgetRepo(dir)
        if (created) await fsp.rm(dir, { recursive: true, force: true })
        else for (const name of await fsp.readdir(dir).catch(() => [])) await fsp.rm(join(dir, name), { recursive: true, force: true })
        throw new Error(explain(e))
    }
    if (!(await hasHead(dir))) await fsp.writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

export async function initRepo(dir: string): Promise<void> {
    await ensureEmptyDir(dir)
    await fsp.mkdir(dir, { recursive: true })
    await git.init({ fs, dir, defaultBranch: 'main' })
}

export async function repoStatus(dirs: string[]): Promise<Record<string, 'ok' | 'missing' | 'notGit'>> {
    const out: Record<string, 'ok' | 'missing' | 'notGit'> = {}
    for (const dir of Array.isArray(dirs) ? dirs : []) {
        if (typeof dir !== 'string') continue
        const st = await fsp.stat(dir).catch(() => null)
        out[dir] = !st?.isDirectory() ? 'missing' : fs.existsSync(join(dir, '.git')) ? 'ok' : 'notGit'
    }
    return out
}

export async function openRepo(dir: string): Promise<{ ok: boolean; message?: string }> {
    if (!fs.existsSync(join(dir, '.git'))) return { ok: false, message: 'このフォルダは版管理されていません' }
    return { ok: true }
}

export async function walkMd(root: string, dir = root, out: string[] = []): Promise<string[]> {
    for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.isSymbolicLink()) continue
        const full = join(dir, ent.name)
        if (ent.isDirectory()) await walkMd(root, full, out)
        else if (ent.name.toLowerCase().endsWith('.md')) out.push(toPosix(relative(root, full)))
    }
    return out
}

async function sameIgnoringEol(dir: string, head: string, filepath: string): Promise<boolean> {
    const stored = await git.readBlob({ fs, dir, oid: head, filepath }).then(
        (r) => r.blob,
        () => null,
    )
    const work = await fsp.readFile(safeJoin(dir, filepath)).catch(() => null)
    if (!stored || !work) return false
    if (stored.includes(0) || work.includes(0)) return false
    const norm = (b: Uint8Array) => Buffer.from(b).toString('utf8').replace(/\r\n/g, '\n')
    return norm(stored) === norm(work)
}

const versioned = (path: string, head: number) => head === 1 || path.toLowerCase().endsWith('.md') || imageExt(path) !== null

async function realStatus(dir: string) {
    const [matrix, head] = await Promise.all([git.statusMatrix({ fs, dir }), tryResolve(dir, 'HEAD')])
    const rows = matrix.filter(([p, h, work, stage]) => !(h === 1 && work === 1 && stage === 1) && versioned(p, h))
    const sameEol = await Promise.all(rows.map(async ([p, h, work]) => (head && h === 1 && work === 2 ? sameIgnoringEol(dir, head, p) : false)))
    return rows.filter((_, i) => !sameEol[i])
}

export async function changedPaths(dir: string): Promise<Set<string>> {
    if (!(await hasHead(dir))) return new Set(await walkMd(dir))
    return new Set((await realStatus(dir)).filter(([, head, work]) => !(head === 1 && work === 1)).map(([p]) => p))
}

export async function requireClean(dir: string, action: string) {
    if ((await changedPaths(dir)).size > 0) {
        throw new Error(`版を保存していない変更があります。「版を保存」するか「変更を取り消す」をしてから${action}してください`)
    }
}

async function readHead(full: string, bytes = 4096): Promise<string> {
    const fh = await fsp.open(full, 'r')
    try {
        const buf = Buffer.alloc(bytes)
        const { bytesRead } = await fh.read(buf, 0, bytes, 0)
        return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
        await fh.close()
    }
}

const titleMemo = new Map<string, { mtime: number; title: string }>()

async function docTitle(dir: string, path: string): Promise<string | null> {
    const full = join(dir, path)
    const st = await fsp.stat(full).catch(() => null)
    if (!st) return null
    const hit = titleMemo.get(full)
    if (hit?.mtime === st.mtimeMs) return hit.title
    const title = /^# (.+)$/m.exec(await readHead(full))?.[1].trim() ?? basename(path, '.md')
    remember(titleMemo, full, { mtime: st.mtimeMs, title }, 5000)
    return title
}

export async function listDocTitles(dir: string): Promise<{ path: string; title: string }[]> {
    const docs = await Promise.all((await walkMd(dir)).map(async (path) => ({ path, title: await docTitle(dir, path) })))
    return docs.filter((d): d is { path: string; title: string } => d.title !== null).sort((a, b) => a.path.localeCompare(b.path, 'ja'))
}

export async function listDocs(dir: string): Promise<DocFile[]> {
    const [docs, changed] = await Promise.all([listDocTitles(dir), changedPaths(dir)])
    return docs.map((d) => ({ ...d, changed: changed.has(d.path) }))
}

export async function readDoc(dir: string, path: string): Promise<string> {
    return fsp.readFile(safeJoin(dir, path), 'utf8')
}

export function writeDoc(dir: string, path: string, content: string): Promise<void> {
    return withRepoLock(dir, async () => {
        const full = safeJoin(dir, path)
        await fsp.mkdir(dirname(full), { recursive: true })
        await writeAtomic(full, content)
    })
}

export async function createDoc(dir: string, path: string, title: string, preset: 'law' | 'contract' = 'law'): Promise<void> {
    const full = safeJoin(dir, path)
    if (fs.existsSync(full)) throw new Error('同じ名前の文書がすでにあります')
    await writeDoc(dir, path, newDocText(title, preset))
}

export async function discardChanges(dir: string, path: string): Promise<void> {
    const head = await tryResolve(dir, 'HEAD')
    const inHead = head
        ? await git.readBlob({ fs, dir, oid: head, filepath: path }).then(
              () => true,
              () => false,
          )
        : false
    if (inHead) await git.checkout({ fs, dir, filepaths: [path], force: true })
    else await fsp.rm(safeJoin(dir, path), { force: true })
}

const DRAFT_PREFIX = '案/'

export async function mainBranch(dir: string): Promise<string> {
    const locals = await git.listBranches({ fs, dir })
    if (locals.includes('main')) return 'main'
    if (locals.includes('master')) return 'master'
    const remotes = (await hasRemote(dir)) ? await git.listBranches({ fs, dir, remote: 'origin' }) : []
    if (remotes.includes('master') && !remotes.includes('main')) return 'master'
    return 'main'
}

async function branchName(dir: string) {
    return (await git.currentBranch({ fs, dir })) ?? (await mainBranch(dir))
}

export function branchLabel(name: string, main: string) {
    if (name === main) return '現行版'
    return name.startsWith(DRAFT_PREFIX) ? name.slice(DRAFT_PREFIX.length) : name
}

export function draftRef(label: string): string {
    const slug = label
        .trim()
        .replace(/[\s~^:?*[\]\\/]+/g, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/@\{/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .replace(/\.lock$/i, '-lock')
    if (!slug) throw new Error('改定案の名前を入力してください')
    return DRAFT_PREFIX + slug
}

export async function branchOid(dir: string, name: string): Promise<string> {
    const oid = (await tryResolve(dir, `refs/heads/${name}`)) ?? (await tryResolve(dir, `refs/remotes/origin/${name}`))
    if (!oid) throw new Error(`改定案「${name}」が見つかりません`)
    return oid
}

async function mergeBase(dir: string, a: string, b: string) {
    return (await git.findMergeBase({ fs, dir, oids: [a, b] }))[0] as string | undefined
}

const tryParents = (dir: string, oid: string) =>
    readCommitCached(dir, oid).then(
        (c) => c.parent,
        () => null,
    )
const parentsOf = async (dir: string, oid: string) => (await tryParents(dir, oid)) ?? []

async function ancestors(dir: string, oid: string): Promise<Set<string>> {
    const memo = memoOf(dir).ancestors
    const hit = memo.get(oid)
    if (hit) return hit
    const seen = new Set<string>()
    const stack = [oid]
    let complete = true
    while (stack.length) {
        const o = stack.pop()!
        if (seen.has(o)) continue
        seen.add(o)
        const ps = await tryParents(dir, o)
        if (ps) stack.push(...ps)
        else complete = false
    }
    return complete ? remember(memo, oid, seen, 8) : seen
}

async function onlyIn(dir: string, a: string, b: string, bAnc: Set<string>) {
    const seen = new Set<string>()
    const stack = [a]
    let reaches = false
    while (stack.length && seen.size < 500) {
        const o = stack.pop()!
        if (o === b) reaches = true
        if (seen.has(o) || bAnc.has(o)) continue
        seen.add(o)
        stack.push(...(await parentsOf(dir, o)))
    }
    return { count: seen.size, reaches }
}

async function countOnlyIn(dir: string, a: string, b: string | null): Promise<number> {
    if (!b) return (await onlyIn(dir, a, '', new Set())).count
    return (await onlyIn(dir, a, b, await ancestors(dir, b))).count
}

export async function currentLabel(dir: string): Promise<string> {
    const cur = await git.currentBranch({ fs, dir })
    return cur ? branchLabel(cur, await mainBranch(dir)) : '現行版'
}

export async function listBranches(dir: string): Promise<BranchInfo[]> {
    if (!(await hasHead(dir))) return []
    const main = await mainBranch(dir)
    const current = await git.currentBranch({ fs, dir })
    const locals = (await git.listBranches({ fs, dir })).filter((b) => b !== RECORDS_BRANCH)
    const remotes = (await hasRemote(dir)) ? (await git.listBranches({ fs, dir, remote: 'origin' })).filter((b) => b !== 'HEAD' && b !== RECORDS_BRANCH) : []
    const mainOid = (await tryResolve(dir, `refs/heads/${main}`)) ?? (await tryResolve(dir, `refs/remotes/origin/${main}`))
    const names = [...new Set([...locals, ...remotes])]
    const oids = await Promise.all(names.map((name) => branchOid(dir, name)))
    const memo = memoOf(dir)
    const key = JSON.stringify([main, current, mainOid, locals, remotes, oids])
    if (memo.branches?.key === key) return memo.branches.list.map((b) => ({ ...b }))
    const mainAnc = mainOid ? await ancestors(dir, mainOid) : new Set<string>()
    const out = await Promise.all(
        names.map(async (name, i): Promise<BranchInfo> => {
            const oid = oids[i]
            const commit = await readCommitCached(dir, oid)
            const isMain = name === main
            let changes = 0
            let mainMoved = false
            if (!isMain && mainOid) {
                const r = await onlyIn(dir, oid, mainOid, mainAnc)
                changes = r.count
                mainMoved = !r.reaches
            }
            return {
                name,
                label: branchLabel(name, main),
                isMain,
                current: name === current,
                local: locals.includes(name),
                remote: remotes.includes(name),
                oid,
                timestamp: commit.author.timestamp,
                author: commit.author.name,
                changes,
                mainMoved,
            }
        }),
    )
    out.sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : b.timestamp - a.timestamp))
    memo.branches = { key, list: out }
    return out.map((b) => ({ ...b }))
}

export async function createBranch(dir: string, label: string, from?: string): Promise<string> {
    const name = draftRef(label)
    if (!(await hasHead(dir))) {
        const tree = await git.writeTree({ fs, dir, tree: [] })
        await git.commit({ fs, dir, message: 'リポジトリを作成', author: await author(dir), tree, parent: [] })
    }
    const exists = (await tryResolve(dir, `refs/heads/${name}`)) || (await tryResolve(dir, `refs/remotes/origin/${name}`))
    if (exists) throw new Error(`「${branchLabel(name, '')}」という改定案はすでにあります`)
    const current = await git.currentBranch({ fs, dir })
    if (!from || from === current) {
        await git.branch({ fs, dir, ref: name, checkout: true })
        return name
    }
    await requireClean(dir, '別の案から改定案を作成')
    await git.branch({ fs, dir, ref: name, object: await branchOid(dir, from) })
    await git.checkout({ fs, dir, ref: name })
    return name
}

export async function switchBranch(dir: string, name: string): Promise<void> {
    if ((await git.currentBranch({ fs, dir })) === name) return
    await requireClean(dir, '切り替え')
    const local = await tryResolve(dir, `refs/heads/${name}`)
    if (!local) await git.branch({ fs, dir, ref: name, object: await branchOid(dir, name) })
    await git.checkout({ fs, dir, ref: name, force: true })
}

export async function deleteBranch(dir: string, name: string): Promise<void> {
    const main = await mainBranch(dir)
    if (name === main) throw new Error('現行版は削除できません')
    if ((await git.currentBranch({ fs, dir })) === name) {
        await requireClean(dir, '改定案を削除')
        await git.checkout({ fs, dir, ref: main, force: true })
    }
    if (await tryResolve(dir, `refs/remotes/origin/${name}`)) {
        if (!(await tryResolve(dir, `refs/heads/${name}`))) {
            await git.branch({ fs, dir, ref: name, object: await branchOid(dir, name) })
        }
        try {
            await git.push({ fs, http, dir, remote: 'origin', ref: name, delete: true, onAuth })
        } catch (e) {
            throw new Error(`リモートから改定案を削除できませんでした（${explain(e)}）`)
        }
        await git.deleteRef({ fs, dir, ref: `refs/remotes/origin/${name}` }).catch(() => {})
    }
    if (await tryResolve(dir, `refs/heads/${name}`)) await git.deleteBranch({ fs, dir, ref: name })
}

const peeled = new Map<string, string>()
async function peelTag(dir: string, oid: string): Promise<string> {
    const hit = peeled.get(oid)
    if (hit) return hit
    const target = await git.readTag({ fs, dir, oid }).then(
        (r) => r.tag.object,
        () => oid,
    )
    return remember(peeled, oid, target, 20_000)
}

async function tagRefs(dir: string): Promise<{ tag: string; oid: string }[]> {
    const tags = await git.listTags({ fs, dir })
    return Promise.all(tags.map(async (tag) => ({ tag, oid: await git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` }) })))
}

async function tagMap(dir: string): Promise<Map<string, string[]>> {
    const refs = await tagRefs(dir)
    const memo = memoOf(dir)
    const key = refs.map((r) => `${r.tag}=${r.oid}`).join('\n')
    if (memo.tags?.key === key) return memo.tags.map
    const map = new Map<string, string[]>()
    for (const r of refs) {
        const oid = await peelTag(dir, r.oid)
        map.set(oid, [...(map.get(oid) ?? []), r.tag])
    }
    memo.tags = { key, map }
    return map
}

async function blobAt(dir: string, commit: string, path: string): Promise<string | null> {
    try {
        let tree = (await readCommitCached(dir, commit)).tree
        const parts = path.split('/')
        for (let i = 0; i < parts.length; i++) {
            const e = (await treeOf(dir, tree)).get(parts[i])
            if (!e) return null
            if (i === parts.length - 1) return e.type === 'blob' ? e.oid : null
            if (e.type !== 'tree') return null
            tree = e.oid
        }
        return null
    } catch (e) {
        if ((e as { code?: string })?.code === 'NotFoundError') return null
        console.error('[git] 版の中のファイルを読めませんでした', commit, path, e)
        throw e
    }
}

function topoSort(list: CommitInfo[]): CommitInfo[] {
    const byOid = new Map(list.map((c) => [c.oid, c]))
    const children = new Map<string, number>(list.map((c) => [c.oid, 0]))
    for (const c of list) for (const p of c.parents) if (byOid.has(p)) children.set(p, children.get(p)! + 1)
    const ready = list.filter((c) => children.get(c.oid) === 0)
    const out: CommitInfo[] = []
    while (ready.length) {
        ready.sort((a, b) => b.timestamp - a.timestamp)
        const c = ready.shift()!
        out.push(c)
        for (const p of c.parents) {
            if (!byOid.has(p)) continue
            const n = children.get(p)! - 1
            children.set(p, n)
            if (n === 0) ready.push(byOid.get(p)!)
        }
    }
    return out
}

export async function log(dir: string, path?: string, all = false): Promise<CommitInfo[]> {
    if (!(await hasHead(dir))) return []
    const main = await mainBranch(dir)
    const tags = await tagMap(dir)
    const tips: { name: string; ref: string }[] = [{ name: (await git.currentBranch({ fs, dir })) ?? main, ref: 'HEAD' }]
    if (all) {
        for (const b of await git.listBranches({ fs, dir })) {
            if (b !== RECORDS_BRANCH) tips.push({ name: b, ref: `refs/heads/${b}` })
        }
        if (await hasRemote(dir)) {
            for (const b of await git.listBranches({ fs, dir, remote: 'origin' })) {
                if (b !== 'HEAD' && b !== RECORDS_BRANCH) tips.push({ name: b, ref: `refs/remotes/origin/${b}` })
            }
        }
    }
    const graph = new Map<string, { commit: CommitObject }>()
    const tipOf = new Map<string, string[]>()
    const shown = new Set<string>()
    const tipOids = (await Promise.all(tips.map(async (tip) => ({ name: tip.name, oid: await tryResolve(dir, tip.ref) })))).filter(
        (t): t is { name: string; oid: string } => !!t.oid,
    )
    let frontier = [...new Set(tipOids.map((t) => t.oid))]
    while (frontier.length && graph.size < 3000) {
        const batch = [...new Set(frontier.filter((o) => !graph.has(o)))].slice(0, 3000 - graph.size)
        const read = await Promise.all(batch.map((oid) => readCommitCached(dir, oid).catch(() => null)))
        frontier = []
        batch.forEach((oid, i) => {
            const commit = read[i]
            if (!commit) return
            graph.set(oid, { commit })
            for (const p of commit.parent) if (!graph.has(p)) frontier.push(p)
        })
    }

    if (path) {
        const blobOf = (commit: string) => blobAt(dir, commit, path)
        const entries = [...graph]
        const changed = await Promise.all(
            entries.map(async ([oid, e]) => {
                const first = e.commit.parent[0]
                const [mine, before] = await Promise.all([blobOf(oid), first && graph.has(first) ? blobOf(first) : null])
                return mine !== before
            }),
        )
        entries.forEach(([oid], i) => changed[i] && shown.add(oid))
    } else {
        for (const oid of graph.keys()) shown.add(oid)
    }

    const nearestShown = (oid: string): string | null => {
        let cur: string | undefined = oid
        while (cur && graph.has(cur)) {
            if (shown.has(cur)) return cur
            cur = graph.get(cur)!.commit.parent[0]
        }
        return null
    }

    const lineOf = (oid: string | null): Set<string> => {
        const out = new Set<string>()
        let cur: string | undefined = oid ?? undefined
        while (cur && graph.has(cur)) {
            if (shown.has(cur)) out.add(cur)
            cur = graph.get(cur)!.commit.parent[0]
        }
        return out
    }
    const headOid = await tryResolve(dir, 'HEAD')
    const mainOid = await branchOid(dir, main).catch(() => null)
    const currentLine = lineOf(headOid)
    const mainLine = lineOf(mainOid)
    for (const t of tipOids) {
        const at = nearestShown(t.oid)
        if (!at) continue
        if (path && t.name !== main && mainLine.has(at)) continue
        const label = branchLabel(t.name, main)
        tipOf.set(at, [...new Set([...(tipOf.get(at) ?? []), label])])
    }
    const headShown = headOid ? nearestShown(headOid) : null
    const linesOf = new Map<string, string[]>()
    for (const t of tipOids) {
        if (t.name === RECORDS_BRANCH) continue
        for (const oid of lineOf(t.oid)) {
            const names = linesOf.get(oid) ?? []
            if (!names.includes(t.name)) names.push(t.name)
            linesOf.set(oid, names)
        }
    }

    const shownParents = (oid: string): string[] => {
        const out: string[] = []
        const seen = new Set<string>()
        for (const direct of graph.get(oid)?.commit.parent ?? []) {
            const stack = [direct]
            while (stack.length) {
                const p = stack.pop()!
                if (seen.has(p)) continue
                seen.add(p)
                if (shown.has(p)) {
                    if (!out.includes(p)) out.push(p)
                } else {
                    stack.push(...[...(graph.get(p)?.commit.parent ?? [])].reverse())
                }
            }
        }
        return out
    }

    const list: CommitInfo[] = [...shown]
        .filter((oid) => graph.has(oid))
        .map((oid) => {
            const e = graph.get(oid)!
            return {
                oid,
                parents: path ? shownParents(oid) : e.commit.parent,
                message: e.commit.message.trim(),
                author: e.commit.author.name,
                timestamp: e.commit.author.timestamp,
                tags: tags.get(oid) ?? [],
                branches: tipOf.get(oid) ?? [],
                head: oid === headShown,
                onCurrent: currentLine.has(oid),
                onMain: mainLine.has(oid),
                lines: linesOf.get(oid) ?? [],
            }
        })
    return topoSort(list)
}

type TreeChanges = Map<string, string | null>

async function patchTree(dir: string, treeOid: string | null, changes: TreeChanges): Promise<string | null> {
    const entries = new Map<string, TreeEntry>(treeOid ? await treeOf(dir, treeOid) : [])
    const subs = new Map<string, TreeChanges>()
    for (const [path, oid] of changes) {
        const i = path.indexOf('/')
        if (i >= 0) {
            const name = path.slice(0, i)
            subs.set(name, (subs.get(name) ?? new Map()).set(path.slice(i + 1), oid))
            continue
        }
        const cur = entries.get(path)
        if (oid === null) entries.delete(path)
        else entries.set(path, { mode: cur?.type === 'blob' ? cur.mode : '100644', path, oid, type: 'blob' })
    }
    for (const [name, list] of subs) {
        const cur = entries.get(name)
        const oid = await patchTree(dir, cur?.type === 'tree' ? cur.oid : null, list)
        if (oid) entries.set(name, { mode: '040000', path: name, oid, type: 'tree' })
        else entries.delete(name)
    }
    if (!entries.size) return null
    return git.writeTree({ fs, dir, tree: [...entries.values()] })
}

async function commitTree(dir: string, base: string | null, changes: TreeChanges, message: string, parent: string[]) {
    const who = await author(dir)
    const baseTree = base ? (await readCommitCached(dir, base)).tree : null
    const tree = (await patchTree(dir, baseTree, changes)) ?? (await git.writeTree({ fs, dir, tree: [] }))
    if (tree === baseTree && parent.length < 2) return null
    return git.commit({ fs, dir, message, author: who, tree, parent })
}

async function stagePaths(dir: string, paths: string[]) {
    for (const filepath of paths) {
        if (fs.existsSync(join(dir, filepath))) await git.add({ fs, dir, filepath })
        else await git.remove({ fs, dir, filepath }).catch(() => {})
    }
}

export async function commitPaths(dir: string, paths: string[], message: string): Promise<string | null> {
    const autocrlf = String(await git.getConfig({ fs, dir, path: 'core.autocrlf' }).catch(() => null)) === 'true'
    const changes: TreeChanges = new Map()
    for (const p of paths) {
        let data: Uint8Array | null = await fsp.readFile(safeJoin(dir, p)).catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? null : Promise.reject(e)))
        if (data && autocrlf) {
            try {
                data = new TextEncoder().encode(new TextDecoder('utf8', { fatal: true }).decode(data).replace(/\r\n/g, '\n'))
            } catch {}
        }
        changes.set(p, data ? await git.writeBlob({ fs, dir, blob: data }) : null)
    }
    const head = await tryResolve(dir, 'HEAD')
    const oid = await commitTree(dir, head, changes, message, head ? [head] : [])
    if (oid) await stagePaths(dir, paths)
    return oid
}

export async function commitFile(dir: string, filepath: string, message: string): Promise<boolean> {
    return (await commitPaths(dir, [filepath], message)) !== null
}

export async function lastChange(dir: string, path: string): Promise<{ oid: string; message: string; author: string; timestamp: number } | null> {
    let oid = await tryResolve(dir, 'HEAD')
    for (let i = 0; oid && i < 2000; i++) {
        const commit = await readCommitCached(dir, oid)
        const parent = commit.parent[0]
        const mine = await blobAt(dir, oid, path)
        if (mine === null) return null
        if (!parent || (await blobAt(dir, parent, path)) !== mine) {
            return { oid, message: commit.message, author: commit.author.name, timestamp: commit.author.timestamp }
        }
        oid = parent
    }
    return null
}

export async function readAt(dir: string, oid: string, path: string): Promise<string | null> {
    try {
        if (oid === 'HEAD') oid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
        const { blob } = await git.readBlob({ fs, dir, oid, filepath: path })
        return new TextDecoder().decode(blob)
    } catch {
        return null
    }
}

const EFFECTIVE_PREFIX = '施行/'
const effectiveTag = (docPath: string, date: string) => `${EFFECTIVE_PREFIX}${docPath.replace(/\.md$/i, '')}/${date}`

export async function tagEffective(dir: string, docPaths: string[], date: string, oid: string) {
    const who = await author(dir)
    for (const p of docPaths) {
        const ref = effectiveTag(p, date)
        await git.annotatedTag({ fs, dir, ref, object: oid, message: `${p} 施行日 ${date}`, tagger: who, force: true })
        await addPendingTag(dir, ref)
    }
    const untags = await pendingUntags(dir)
    const rest = untags.filter((t) => !docPaths.some((p) => effectiveTag(p, date) === t))
    if (rest.length !== untags.length) await fsp.writeFile(untagFile(dir), rest.map((t) => `${t}\n`).join(''), 'utf8')
}

export interface EffectiveVersion {
    tag: string
    date: string
    oid: string
    message: string
    author: string
    timestamp: number
}

export async function listEffective(dir: string, docPath: string): Promise<EffectiveVersion[]> {
    const prefix = `施行/${docPath.replace(/\.md$/i, '')}/`
    const out: EffectiveVersion[] = []
    for (const tag of await git.listTags({ fs, dir })) {
        if (!tag.startsWith(prefix)) continue
        const date = tag.slice(prefix.length)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        const oid = await peelTag(dir, await git.resolveRef({ fs, dir, ref: `refs/tags/${tag}` }))
        const commit = await readCommitCached(dir, oid)
        const message = commit.message.replace(/\n+施行日: \S+\s*$/, '').trim()
        out.push({ tag, date, oid, message, author: commit.author.name, timestamp: commit.author.timestamp })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date))
}

export async function addEffective(dir: string, docPath: string, oid: string, date: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('施行日の形式が正しくありません')
    if ((await readAt(dir, oid, docPath)) === null) throw new Error('この版にはこの文書がありません')
    await tagEffective(dir, [docPath], date, oid)
    await push(dir)
}

export async function removeEffective(dir: string, docPath: string, date: string): Promise<void> {
    const tag = effectiveTag(docPath, date)
    const pending = await pendingTags(dir)
    if (await hasRemote(dir)) {
        const ok = await git.push({ fs, http, dir, remote: 'origin', ref: `refs/tags/${tag}`, delete: true, onAuth }).then(
            () => true,
            () => false,
        )
        if (!ok) await fsp.appendFile(untagFile(dir), tag + '\n', 'utf8')
    }
    await git.deleteRef({ fs, dir, ref: `refs/tags/${tag}` }).catch(() => {})
    const rest = pending.filter((t) => t !== tag)
    await fsp.writeFile(pendingFile(dir), rest.map((t) => `${t}\n`).join(''), 'utf8')
}

export async function saveVersion(dir: string, input: SaveVersionInput): Promise<string> {
    const head = await hasHead(dir)
    const changed = await realStatus(dir)
    if (changed.length === 0 && head) throw new Error('前の版から変更がありません')
    const gone = changed.filter(([, , work]) => work === 0).map(([p]) => p)
    const kept = changed.filter(([, , work]) => work !== 0).map(([p]) => p)
    if (gone.length) await git.remove({ fs, dir, filepath: gone })
    if (kept.length) await git.add({ fs, dir, filepath: kept })
    const message = input.effectiveDate ? `${input.message}\n\n施行日: ${input.effectiveDate}` : input.message
    const oid = await git.commit({ fs, dir, message, author: await author(dir) })
    if (input.effectiveDate) await tagEffective(dir, [input.docPath ?? 'all'], input.effectiveDate, oid)
    return oid
}

const pendingFile = (dir: string) => join(dir, '.git', 'clausedown-pending-tags')

export async function addPendingTag(dir: string, ref: string) {
    await fsp.appendFile(pendingFile(dir), ref + '\n', 'utf8')
}

async function readLines(file: string): Promise<string[]> {
    try {
        return [...new Set((await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean))]
    } catch {
        return []
    }
}
const pendingTags = (dir: string) => readLines(pendingFile(dir))

const untagFile = (dir: string) => join(dir, '.git', 'clausedown-pending-untags')
const pendingUntags = (dir: string) => readLines(untagFile(dir))

async function pushUntags(dir: string) {
    const list = await pendingUntags(dir)
    if (!list.length) return
    for (const tag of list) await git.push({ fs, http, dir, remote: 'origin', ref: `refs/tags/${tag}`, delete: true, onAuth }).catch(() => {})
    await fsp.rm(untagFile(dir), { force: true })
}

async function pruneEffectiveTags(dir: string) {
    const url = await remoteUrl(dir)
    if (!url) return
    const refs = await git.listServerRefs({ http, url, onAuth, prefix: 'refs/tags/' })
    const remote = new Set(refs.map((r) => r.ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')))
    const keep = new Set(await pendingTags(dir))
    for (const tag of await git.listTags({ fs, dir })) {
        if (!tag.startsWith(EFFECTIVE_PREFIX) || remote.has(tag) || keep.has(tag)) continue
        await git.deleteRef({ fs, dir, ref: `refs/tags/${tag}` }).catch(() => {})
    }
}

async function fastForwardOthers(dir: string, current: string) {
    for (const b of await git.listBranches({ fs, dir })) {
        if (b === current) continue
        const local = await tryResolve(dir, `refs/heads/${b}`)
        const remote = await tryResolve(dir, `refs/remotes/origin/${b}`)
        if (!local || !remote || local === remote) continue
        if (await git.isDescendent({ fs, dir, oid: remote, ancestor: local, depth: -1 })) {
            await git.writeRef({ fs, dir, ref: `refs/heads/${b}`, value: remote, force: true })
        }
    }
}

export async function sync(dir: string): Promise<SyncState> {
    try {
        if (!(await hasRemote(dir))) return { state: 'local' }
        const branch = await branchName(dir)
        const local = await tryResolve(dir, branch)

        await git.fetch({ fs, http, dir, remote: 'origin', singleBranch: false, onAuth, tags: true, prune: true })
        dropCache(dir)
        const dirty = (await changedPaths(dir)).size > 0
        await pruneEffectiveTags(dir).catch(() => {})
        for (const tag of await pendingUntags(dir)) await git.deleteRef({ fs, dir, ref: `refs/tags/${tag}` }).catch(() => {})
        await fastForwardOthers(dir, branch)
        const remote = await tryResolve(dir, `refs/remotes/origin/${branch}`)

        if (!remote) {
            if (!local) return { state: 'upToDate' }
            const main = await mainBranch(dir)
            const base = await tryResolve(dir, `refs/remotes/origin/${main}`)
            return { state: 'ahead', count: await countOnlyIn(dir, local, base === local ? null : base) }
        }
        if (!local) {
            if (dirty) return { state: 'dirty' }
            await git.branch({ fs, dir, ref: branch, object: remote, force: true, checkout: false })
            await git.checkout({ fs, dir, ref: branch, force: true })
            return { state: 'behind' }
        }
        if (local === remote) {
            const waiting = (await pendingTags(dir)).length + (await pendingUntags(dir)).length
            return waiting ? { state: 'ahead', count: 0 } : { state: 'upToDate' }
        }
        if (await git.isDescendent({ fs, dir, oid: local, ancestor: remote, depth: -1 })) {
            return { state: 'ahead', count: await countOnlyIn(dir, local, remote) }
        }
        if (dirty) return { state: 'dirty' }
        if (await git.isDescendent({ fs, dir, oid: remote, ancestor: local, depth: -1 })) {
            await git.merge({ fs, dir, ours: branch, theirs: remote, fastForwardOnly: true, author: await author(dir) })
            await git.checkout({ fs, dir, ref: branch, force: true })
            return { state: 'behind' }
        }
        const a = await analyze(dir, local, remote)
        return { state: 'diverged', conflicts: a.conflicts, autoMerged: [...a.autoMerged.keys()], theirs: remote }
    } catch (e) {
        return { state: 'error', message: explain(e) }
    }
}

export async function pushRef(dir: string, ref: string, force = false) {
    const res = await git.push({ fs, http, dir, remote: 'origin', ref, onAuth, force })
    if (!res.ok) throw Object.assign(new Error('rejected'), { code: 'PushRejectedError' })
}

export async function push(dir: string): Promise<SyncState> {
    try {
        if (!(await hasRemote(dir))) return { state: 'local' }
        await pushRef(dir, await branchName(dir))
        const failed: { tag: string; error: unknown }[] = []
        for (const tag of await pendingTags(dir)) {
            await pushRef(dir, `refs/tags/${tag}`, tag.startsWith(EFFECTIVE_PREFIX)).catch((error) => failed.push({ tag, error }))
        }
        if (failed.length) await fsp.writeFile(pendingFile(dir), failed.map((f) => `${f.tag}\n`).join(''), 'utf8')
        else await fsp.rm(pendingFile(dir), { force: true })
        await pushUntags(dir)
        await pushRecords(dir)
        if (failed.length) {
            const { tag, error } = failed[0]
            const why = (error as { code?: string })?.code === 'PushRejectedError' ? 'リモートにある同じ名前の記録を置き換えられませんでした' : explain(error)
            return { state: 'error', message: `施行日の記録「${tag}」を送信できませんでした（${why}）` }
        }
        return { state: 'upToDate' }
    } catch (e) {
        return { state: 'error', message: explain(e) }
    }
}

export async function pushEverything(dir: string): Promise<void> {
    const main = await mainBranch(dir)
    const rank = (b: string) => (b === main ? 0 : b === RECORDS_BRANCH ? 2 : 1)
    const branches = (await git.listBranches({ fs, dir })).sort((a, b) => rank(a) - rank(b))
    for (const b of branches) await pushRef(dir, b)
    for (const t of await git.listTags({ fs, dir })) await pushRef(dir, `refs/tags/${t}`)
}

export async function publishRepo(dir: string, rawUrl: string): Promise<string> {
    let url = String(rawUrl ?? '')
        .trim()
        .replace(/\/+$/, '')
    if (!safeRemoteUrl(url)) throw new Error('リモートの URL は https:// で始まるものを入力してください')
    if (matchRemote(url, knownBases(await loadSettings())) && !/\.git$/i.test(url)) url += '.git'
    if (await hasRemote(dir)) throw new Error('このリポジトリには、すでにリモートが設定されています')
    if (!(await hasHead(dir))) throw new Error('まだ版が保存されていません。最初の版を保存してから共有してください')

    let refs: { ref: string; oid: string }[]
    try {
        refs = await git.listServerRefs({ http, url, onAuth, forPush: true })
    } catch (e) {
        throw new Error(explain(e))
    }
    for (const r of refs.filter((r) => r.ref.startsWith('refs/'))) {
        if ((await tryResolve(dir, r.ref)) !== r.oid) {
            throw new Error('リモートのリポジトリが空ではありません。README などを付けずに、空のリポジトリとして作り直してください')
        }
    }

    await git.addRemote({ fs, dir, remote: 'origin', url })
    try {
        await pushEverything(dir)
        await fsp.rm(pendingFile(dir), { force: true })
        await git.fetch({ fs, http, dir, remote: 'origin', singleBranch: false, onAuth, tags: true })
    } catch (e) {
        await git.deleteRemote({ fs, dir, remote: 'origin' }).catch(() => {})
        throw new Error(explain(e))
    }
    return url
}

export async function changeRemote(dir: string, rawUrl: string): Promise<string> {
    let url = String(rawUrl ?? '')
        .trim()
        .replace(/\/+$/, '')
    if (!safeRemoteUrl(url)) throw new Error('リモートの URL は https:// で始まるものを入力してください')
    if (matchRemote(url, knownBases(await loadSettings())) && !/\.git$/i.test(url)) url += '.git'
    const before = await remoteUrl(dir)
    if (!before) return publishRepo(dir, url)
    if (before === url) return url

    let refs: { ref: string; oid: string }[]
    try {
        refs = (await git.listServerRefs({ http, url, onAuth, forPush: true })).filter((r) => r.ref.startsWith('refs/heads/'))
    } catch (e) {
        throw new Error(explain(e))
    }
    if (refs.length) {
        const known = await Promise.all(
            refs.map((r) =>
                git.readCommit({ fs, dir, oid: r.oid }).then(
                    () => true,
                    () => false,
                ),
            ),
        )
        if (!known.some(Boolean)) throw new Error('このリモートには、このリポジトリとは別の履歴があります。正しい URL か確かめてください')
    }

    await git.setConfig({ fs, dir, path: 'remote.origin.url', value: url })
    try {
        if (!refs.length) await pushEverything(dir)
        await git.fetch({ fs, http, dir, remote: 'origin', singleBranch: false, onAuth, tags: true })
    } catch (e) {
        await git.setConfig({ fs, dir, path: 'remote.origin.url', value: before })
        throw new Error(explain(e))
    }
    return url
}

export async function disconnectRemote(dir: string): Promise<void> {
    if (!(await hasRemote(dir))) return
    for (const b of await git.listBranches({ fs, dir, remote: 'origin' })) {
        await git.deleteRef({ fs, dir, ref: `refs/remotes/origin/${b}` }).catch(() => {})
    }
    await git.deleteRemote({ fs, dir, remote: 'origin' })
    await fsp.rm(pendingFile(dir), { force: true })
}

interface Merge3 {
    path: string
    base?: string
    ours?: string
    theirs?: string
}

async function threeWay(dir: string, base: string | undefined, ours: string, theirs: string): Promise<Merge3[]> {
    const out: Merge3[] = []
    await git.walk({
        fs,
        dir,
        trees: [TREE({ ref: base ?? ours }), TREE({ ref: ours }), TREE({ ref: theirs })],
        map: async (filepath, entries) => {
            if (filepath === '.') return true
            const [b, o, t] = entries
            const types = await Promise.all([o, t, base ? b : null].map(async (e) => e?.type()))
            const [oo, to, bo] = await Promise.all([o?.oid(), t?.oid(), base ? b?.oid() : undefined])
            if (oo !== undefined && oo === to && types[0] === types[1]) return null
            if (base && bo !== undefined && bo === to && types[1] === types[2]) return null
            if (types.includes('tree')) return true
            const blob = (type: string | undefined, oid: string | undefined) => (type === 'blob' ? oid : undefined)
            out.push({ path: filepath, base: base ? blob(types[2], bo) : undefined, ours: blob(types[0], oo), theirs: blob(types[1], to) })
            return true
        },
    })
    return out
}

async function blobText(dir: string, oid?: string) {
    if (!oid) return ''
    return new TextDecoder().decode((await git.readBlob({ fs, dir, oid })).blob)
}

const bothChanged = (f: Merge3) => !(f.ours === f.theirs || f.ours === f.base || f.theirs === f.base)

interface Analysis {
    base: string | undefined
    files: Merge3[]
    conflicts: Conflict[]
    autoMerged: Map<string, string>
}

async function analyze(dir: string, ours: string, theirs: string): Promise<Analysis> {
    const memo = memoOf(dir).analyzed
    const key = `${ours}|${theirs}`
    const hit = memo.get(key)
    if (hit) return hit
    const base = await mergeBase(dir, ours, theirs)
    const files = await threeWay(dir, base, ours, theirs)
    const read = await Promise.all(
        files.filter(bothChanged).map(async (f) => {
            const [b, o, t] = await Promise.all([blobText(dir, f.base), blobText(dir, f.ours), blobText(dir, f.theirs)])
            const c: Conflict = { path: f.path, base: b, ours: o, theirs: t, oursDeleted: !f.ours, theirsDeleted: !f.theirs }
            return { c, merged: f.ours && f.theirs ? autoMerge(b, o, t) : null }
        }),
    )
    const conflicts: Conflict[] = []
    const autoMerged = new Map<string, string>()
    for (const { c, merged } of read) {
        if (merged !== null) autoMerged.set(c.path, merged)
        else conflicts.push(c)
    }
    return remember(memo, key, { base, files, conflicts, autoMerged }, 8)
}

const writeText = (dir: string, text: string) => git.writeBlob({ fs, dir, blob: new TextEncoder().encode(text) })

async function planMerge(dir: string, ours: string, theirs: string, choices: Record<string, ConflictChoice>): Promise<TreeChanges> {
    const { files, autoMerged } = await analyze(dir, ours, theirs)
    const plan: TreeChanges = new Map()
    for (const f of files) {
        if (f.ours === f.theirs || f.theirs === f.base) continue
        safeJoin(dir, f.path)
        if (f.ours === f.base) {
            plan.set(f.path, f.theirs ?? null)
            continue
        }
        const choice = choices?.[f.path]
        if (choice && typeof choice === 'object') {
            if (choice.content !== null && typeof choice.content !== 'string') throw new Error(`「${f.path}」の解決内容が正しくありません`)
            plan.set(f.path, choice.content === null ? null : await writeText(dir, choice.content))
        } else if (choice === 'theirs') plan.set(f.path, f.theirs ?? null)
        else if (choice === 'ours') continue
        else if (autoMerged.has(f.path)) plan.set(f.path, await writeText(dir, autoMerged.get(f.path)!))
        else throw new Error(`「${f.path}」の重なりが解決されていません`)
    }
    return plan
}

async function commitMerge(dir: string, ours: string, theirs: string, plan: TreeChanges, message: string) {
    const branch = await branchName(dir)
    if ((await git.resolveRef({ fs, dir, ref: branch })) !== ours) throw new Error('統合の途中で版が変わりました。もう一度やり直してください')
    const oid = (await commitTree(dir, ours, plan, message, [ours, theirs]))!
    for (const [path, blob] of plan) {
        const full = safeJoin(dir, path)
        if (blob === null) {
            await fsp.rm(full, { force: true })
            await git.remove({ fs, dir, filepath: path }).catch(() => {})
        } else {
            await fsp.mkdir(dirname(full), { recursive: true })
            await writeAtomic(full, (await git.readBlob({ fs, dir, oid: blob })).blob)
            await git.add({ fs, dir, filepath: path })
        }
    }
    return { oid, changed: [...plan.keys()] }
}

export async function resolveConflicts(dir: string, theirs: string, choices: Record<string, ConflictChoice>): Promise<SyncState> {
    try {
        await requireClean(dir, '取り込み')
        const ours = await git.resolveRef({ fs, dir, ref: await branchName(dir) })
        const plan = await planMerge(dir, ours, theirs, choices)
        await commitMerge(dir, ours, theirs, plan, 'リモートの変更を取り込みました')
        return push(dir)
    } catch (e) {
        return { state: 'error', message: explain(e) }
    }
}

export async function previewMerge(dir: string, from: string, into: string): Promise<MergePreview> {
    const fromOid = await branchOid(dir, from)
    const intoOid = await branchOid(dir, into)
    if ((await git.isDescendent({ fs, dir, oid: intoOid, ancestor: fromOid, depth: -1 }).catch(() => false)) || fromOid === intoOid) {
        return { upToDate: true, files: [], conflicts: [], autoMerged: [], from: fromOid }
    }
    const { files, conflicts, autoMerged } = await analyze(dir, intoOid, fromOid)
    return {
        upToDate: false,
        files: files.filter((f) => f.theirs !== f.ours && f.theirs !== f.base).map((f) => f.path),
        conflicts,
        autoMerged: [...autoMerged.keys()],
        from: fromOid,
    }
}

export async function mergeBranch(dir: string, input: MergeInput): Promise<SyncState> {
    await requireClean(dir, '反映')
    const fromOid = await branchOid(dir, input.from)
    const intoOid = await branchOid(dir, input.into)
    const plan = await planMerge(dir, intoOid, fromOid, input.choices)
    await switchBranch(dir, input.into)
    const { oid, changed } = await commitMerge(dir, intoOid, fromOid, plan, input.message)
    if (input.effectiveDate) {
        const docs = changed.filter((p) => p.toLowerCase().endsWith('.md'))
        await tagEffective(dir, docs.length ? docs : ['all'], input.effectiveDate, oid)
    }
    const state = await push(dir)
    if (input.deleteAfter && state.state !== 'error') await deleteBranch(dir, input.from)
    return state
}
