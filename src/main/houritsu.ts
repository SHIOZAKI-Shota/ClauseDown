import fs, { promises as fsp } from 'node:fs'
import git from './igit'
import { author } from './git-base'
import { safeJoin, walkMd } from './git'
import { fromHouritsu, isHouritsu, type HouritsuConversion } from '../shared/houritsu'

const HEAD_BYTES = 16 * 1024

async function readHead(full: string): Promise<string> {
    const fh = await fsp.open(full, 'r')
    try {
        const buf = Buffer.alloc(HEAD_BYTES)
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
        return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
        await fh.close()
    }
}

async function inPool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out = Array.from<R>({ length: items.length })
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const i = next++
            out[i] = await fn(items[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
    return out
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r))

export async function detectHouritsu(dir: string): Promise<string[]> {
    const paths = await walkMd(dir)
    const hits = await inPool(paths, 16, async (path) => isHouritsu(await readHead(safeJoin(dir, path)).catch(() => '')))
    return paths.filter((_, i) => hits[i])
}

export async function convertHouritsu(dir: string, paths: string[]): Promise<HouritsuConversion> {
    const wanted = new Set((Array.isArray(paths) ? paths : []).filter((p): p is string => typeof p === 'string'))
    const who = await author(dir)
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    const clean = new Set(
        (await git.statusMatrix({ fs, dir })).filter(([path, h, w, s]) => wanted.has(path) && h === 1 && w === 1 && s === 1).map(([path]) => path),
    )

    const done: string[] = []
    const skipped: string[] = []
    const warnings: HouritsuConversion['warnings'] = []
    try {
        for (const path of wanted) {
            const full = safeJoin(dir, path)
            const text = clean.has(path) ? await fsp.readFile(full, 'utf8').catch(() => '') : ''
            if (!isHouritsu(text)) {
                skipped.push(path)
                continue
            }
            const r = fromHouritsu(text)
            await fsp.writeFile(full, r.text, 'utf8')
            done.push(path)
            if (r.warnings.length) warnings.push({ path, messages: r.warnings })
            await yieldToLoop()
        }
        if (done.length) {
            await git.add({ fs, dir, filepath: done })
            await git.commit({ fs, dir, message: `houritsu の形式から ClauseDown の形に変換（${done.length} 件）`, author: who })
        }
    } catch (e) {
        for (const path of done) {
            const { blob } = await git.readBlob({ fs, dir, oid: head, filepath: path })
            await fsp.writeFile(safeJoin(dir, path), blob)
            await git.resetIndex({ fs, dir, filepath: path }).catch(() => {})
        }
        throw e
    }
    return { converted: done.length, skipped, warnings }
}
