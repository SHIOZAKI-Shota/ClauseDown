import { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_DIR, cleanOverride, styleFileOf, type StyleLayers, type StyleOverride } from '../shared/folder-style'
import { commitFile, safeJoin } from './git'

async function walkStyles(root: string, rel = '', out: string[] = []): Promise<string[]> {
    for (const ent of await fsp.readdir(join(root, rel), { withFileTypes: true }).catch(() => [])) {
        if (ent.isSymbolicLink() || ent.name.startsWith('.')) continue
        const sub = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) await walkStyles(root, sub, out)
        else if (ent.name.endsWith('.json')) out.push(sub.slice(0, -'.json'.length))
    }
    return out
}

async function readLayer(dir: string, folder: string): Promise<StyleOverride | null> {
    const text = await fsp.readFile(safeJoin(dir, styleFileOf(folder)), 'utf8').catch(() => null)
    if (text === null) return null
    try {
        return cleanOverride((JSON.parse(text) as { style?: unknown })?.style)
    } catch {
        return null
    }
}

export async function listFolderStyles(dir: string): Promise<StyleLayers> {
    const layers: StyleLayers = {}
    for (const folder of ['', ...(await walkStyles(join(dir, APP_DIR, 'styles')))]) {
        const layer = await readLayer(dir, folder)
        if (layer) layers[folder] = layer
    }
    return layers
}

export async function saveFolderStyle(dir: string, folder: string, override: StyleOverride): Promise<boolean> {
    if (typeof folder !== 'string' || folder.split('/').some((p) => p === '..' || p.startsWith('.'))) {
        throw new Error('ディレクトリの指定が正しくありません')
    }
    const st = await fsp.stat(safeJoin(dir, folder || '.')).catch(() => null)
    if (!st?.isDirectory()) throw new Error(`ディレクトリ「${folder}」が見つかりません`)
    const o = cleanOverride(override)
    const rel = styleFileOf(folder)
    const full = safeJoin(dir, rel)
    if (Object.keys(o).length === 0) await fsp.rm(full, { force: true })
    else {
        await fsp.mkdir(dirname(full), { recursive: true })
        await fsp.writeFile(full, JSON.stringify({ style: o }, null, 2) + '\n', 'utf8')
    }
    return commitFile(dir, rel, `書式を変更（${folder || 'リポジトリ全体'}）`)
}
