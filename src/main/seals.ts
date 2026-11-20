import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SealMeta } from '../shared/api'
import { t } from '../shared/i18n'
import { writeAtomic } from './atomic'

const dir = () => join(app.getPath('userData'), 'seals')
const indexPath = () => join(dir(), 'index.json')
const ID_RE = /^[0-9a-f-]{36}$/
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const MAX = 5 * 1024 * 1024

async function readIndex(): Promise<SealMeta[]> {
    try {
        const list = JSON.parse(await fs.readFile(indexPath(), 'utf8')) as SealMeta[]
        return Array.isArray(list) ? list.filter((s) => s && ID_RE.test(s.id)) : []
    } catch {
        return []
    }
}

async function writeIndex(list: SealMeta[]): Promise<void> {
    await fs.mkdir(dir(), { recursive: true })
    await writeAtomic(indexPath(), JSON.stringify(list, null, 2))
}

export const listSeals = readIndex

export async function saveSeal(meta: { kind: SealMeta['kind']; label: string }, png: Uint8Array): Promise<SealMeta> {
    const data = new Uint8Array(png)
    if (data.length > MAX || !PNG.every((b, i) => data[i] === b)) throw new Error(t().signing.errors.sealImage)
    const kind = meta.kind === 'sign' || meta.kind === 'image' ? meta.kind : 'seal'
    const entry: SealMeta = { id: randomUUID(), kind, label: String(meta.label ?? '').slice(0, 60), createdAt: new Date().toISOString() }
    await fs.mkdir(dir(), { recursive: true })
    await fs.writeFile(join(dir(), `${entry.id}.png`), data)
    await writeIndex([entry, ...(await readIndex())])
    return entry
}

export async function readSeal(id: string): Promise<Uint8Array> {
    if (!ID_RE.test(String(id))) throw new Error(t().signing.errors.sealImage)
    return new Uint8Array(await fs.readFile(join(dir(), `${id}.png`)))
}

export async function deleteSeal(id: string): Promise<void> {
    if (!ID_RE.test(String(id))) return
    await fs.rm(join(dir(), `${id}.png`), { force: true })
    await writeIndex((await readIndex()).filter((s) => s.id !== id))
}
