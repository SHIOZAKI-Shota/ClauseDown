import fs, { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import type { SavedImage } from '../shared/api'
import { writeAtomic } from './atomic'
import { safeJoin } from './git'
import { imageDest, imageExt, imageMime, imagePathOf, imageSize, sniffImage, type ImageExt } from '../shared/images'

const MAX_BYTES = 20 * 1024 * 1024

export async function saveImage(dir: string, docPath: unknown, data: unknown, ext: unknown): Promise<SavedImage> {
    if (typeof docPath !== 'string' || !docPath.toLowerCase().endsWith('.md')) throw new Error('文書（.md）を指定してください')
    if (!(data instanceof Uint8Array) || !data.length) throw new Error('画像のデータがありません')
    if (data.length > MAX_BYTES) throw new Error('画像が大きすぎます（20MB まで）')
    const kind = sniffImage(data)
    if (!kind) throw new Error('PNG・JPEG・GIF・WebP の画像だけ貼り付けられます')
    const want = typeof ext === 'string' ? imageExt(`.${ext}`) : null
    const use: ImageExt = want && (want === kind || (want === 'jpeg' && kind === 'jpg')) ? want : kind
    const base = imageDest(docPath, use)
    let dest = base
    for (let i = 2; fs.existsSync(safeJoin(dir, dest.path)); i++) {
        dest = { path: base.path.replace(/(\.\w+)$/, `-${i}$1`), src: base.src.replace(/(\.\w+)$/, `-${i}$1`) }
    }
    const full = safeJoin(dir, dest.path)
    await fsp.mkdir(dirname(full), { recursive: true })
    await writeAtomic(full, data)
    return dest
}

export interface ImageFile {
    data: Uint8Array
    ext: ImageExt
    mime: string
    width: number
    height: number
}

export async function readImage(dir: string, docPath: string, src: string): Promise<ImageFile | null> {
    const path = imagePathOf(docPath, src)
    if (!path) return null
    const data = await fsp.readFile(safeJoin(dir, path)).catch(() => null)
    if (!data || data.length > MAX_BYTES) return null
    const ext = sniffImage(data)
    if (!ext) return null
    const size = imageSize(data)
    return { data, ext, mime: imageMime(ext), width: size?.width ?? 0, height: size?.height ?? 0 }
}

export const dataUrl = (img: ImageFile): string => `data:${img.mime};base64,${Buffer.from(img.data).toString('base64')}`
