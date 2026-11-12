import fs, { promises as fsp } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import git from './igit'
import { tryResolve } from './git-base'
import { changedPaths, commitPaths, safeJoin } from './git'

function assertDoc(path: unknown): asserts path is string {
    if (typeof path !== 'string' || !path.toLowerCase().endsWith('.md')) throw new Error('文書（.md）を指定してください')
}

function cleanFolder(folder: unknown): string {
    if (typeof folder !== 'string') throw new Error('移動先のディレクトリを指定してください')
    const f = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (f.split('/').some((p) => p === '..' || p.startsWith('.'))) throw new Error(`使えないディレクトリ名です: ${folder}`)
    return f
}

async function titleOf(dir: string, path: string): Promise<string> {
    const text = await fsp.readFile(safeJoin(dir, path), 'utf8').catch(() => '')
    return /^# (.+)$/m.exec(text)?.[1].trim() ?? posix.basename(path, '.md')
}

async function inHead(dir: string, path: string): Promise<boolean> {
    const head = await tryResolve(dir, 'HEAD')
    if (!head) return false
    return git.readBlob({ fs, dir, oid: head, filepath: path }).then(
        () => true,
        () => false,
    )
}

function copyName(dir: string, folder: string, stem: string): string {
    for (let i = 1; i < 1000; i++) {
        const p = posix.join(folder, `${stem}${i === 1 ? '（コピー）' : `（コピー ${i}）`}.md`)
        if (!fs.existsSync(safeJoin(dir, p))) return p
    }
    throw new Error('コピーに付ける名前がすべて使われています')
}

const folderOf = (path: string) => (posix.dirname(path) === '.' ? '' : posix.dirname(path))

export interface MoveResult {
    path: string
    recorded: boolean
}

export async function moveDoc(dir: string, from: string, toFolder: string): Promise<MoveResult> {
    assertDoc(from)
    const folder = cleanFolder(toFolder)
    const to = posix.join(folder, posix.basename(from))
    if (to === from) return { path: from, recorded: false }
    const src = safeJoin(dir, from)
    const dest = safeJoin(dir, to)
    if (!fs.existsSync(src)) throw new Error('文書が見つかりません')
    if (fs.existsSync(dest)) throw new Error(`移動先に同じ名前の文書があります: ${to}`)

    const tracked = await inHead(dir, from)
    if (tracked && (await changedPaths(dir)).has(from)) {
        throw new Error('この文書には版を保存していない変更があります。先に「版を保存」してから移動してください')
    }
    await fsp.mkdir(dirname(dest), { recursive: true })
    await fsp.rename(src, dest)
    if (!tracked) return { path: to, recorded: false }
    const title = await titleOf(dir, to)
    await commitPaths(dir, [from, to], `「${title}」を移動（${from} → ${to}）`)
    return { path: to, recorded: true }
}

export async function copyDoc(dir: string, path: string): Promise<string> {
    assertDoc(path)
    const text = await fsp.readFile(safeJoin(dir, path), 'utf8')
    const to = copyName(dir, folderOf(path), posix.basename(path, '.md'))
    const out = text.replace(/^# (.+)$/m, (_m, t: string) => `# ${t.trim()}（コピー）`)
    await fsp.writeFile(safeJoin(dir, to), out, 'utf8')
    return to
}

export async function copyDocToRepo(dir: string, path: string, destDir: string): Promise<string> {
    assertDoc(path)
    if (!fs.existsSync(join(destDir, '.git'))) throw new Error('コピー先のフォルダはリポジトリではありません')
    const text = await fsp.readFile(safeJoin(dir, path), 'utf8')
    const to = fs.existsSync(safeJoin(destDir, path)) ? copyName(destDir, folderOf(path), posix.basename(path, '.md')) : path
    const full = safeJoin(destDir, to)
    await fsp.mkdir(dirname(full), { recursive: true })
    await fsp.writeFile(full, text, 'utf8')
    return to
}

export async function deleteDoc(dir: string, path: string): Promise<{ recorded: boolean }> {
    assertDoc(path)
    const full = safeJoin(dir, path)
    if (!fs.existsSync(full)) throw new Error('文書が見つかりません')
    const tracked = await inHead(dir, path)
    const title = await titleOf(dir, path)
    await fsp.rm(full)
    if (!tracked) return { recorded: false }
    await commitPaths(dir, [path], `「${title}」を削除`)
    return { recorded: true }
}
