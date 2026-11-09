export type ImageExt = 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp'

const MIME: Record<ImageExt, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

export function imageExt(path: string): ImageExt | null {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1].toLowerCase()
    return ext && ext in MIME ? (ext as ImageExt) : null
}

export const imageMime = (ext: ImageExt): string => MIME[ext]

export function extOfMime(mime: string): ImageExt | null {
    const found = (Object.keys(MIME) as ImageExt[]).find((k) => MIME[k] === mime.toLowerCase())
    return found === 'jpeg' ? 'jpg' : (found ?? null)
}

export function sniffImage(bytes: Uint8Array): ImageExt | null {
    const b = bytes
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
    return null
}

export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
    const kind = sniffImage(bytes)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (kind === 'png' && bytes.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) }
    if (kind === 'gif' && bytes.length >= 10) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
    if (kind === 'jpg') {
        let i = 2
        while (i + 9 < bytes.length) {
            if (bytes[i] !== 0xff) return null
            const marker = bytes[i + 1]
            if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
                i += marker === 0xff ? 1 : 2
                continue
            }
            const len = dv.getUint16(i + 2)
            if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
            }
            i += 2 + len
        }
        return null
    }
    if (kind === 'webp' && bytes.length >= 30) {
        const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
        if (tag === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
        if (tag === 'VP8L') {
            const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24]
            return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
        }
        if (tag === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) }
    }
    return null
}

export const isLocalSrc = (src: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[\\/#]/.test(src)

const folderOf = (docPath: string) => docPath.split('/').slice(0, -1)

export function imagePathOf(docPath: string, src: string): string | null {
    if (!isLocalSrc(src)) return null
    let rel: string
    try {
        rel = decodeURIComponent(src.split(/[?#]/)[0])
    } catch {
        return null
    }
    const out: string[] = []
    for (const part of [...folderOf(docPath), ...rel.split(/[\\/]/)]) {
        if (!part || part === '.') continue
        if (part === '..') {
            if (!out.length) return null
            out.pop()
        } else out.push(part)
    }
    const path = out.join('/')
    return imageExt(path) ? path : null
}

export const markdownSrc = (rel: string): string => rel.replace(/[ ()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export function imageDest(docPath: string, ext: ImageExt, now = new Date()): { path: string; src: string } {
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
    const base = docPath.split('/').pop()!.replace(/\.md$/i, '')
    const rel = `images/${base}/${stamp}.${ext}`
    return { path: [...folderOf(docPath), rel].join('/'), src: markdownSrc(rel) }
}

const IMG_RE = /<img\b([^>]*?)\ssrc="([^"]*)"/g
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, k: string) => ENTITIES[k])
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function rewriteImages(html: string, fn: (src: string) => string | null): string {
    return html.replace(IMG_RE, (m, pre: string, src: string) => {
        const next = fn(unescape(src))
        return next === null ? m : `<img${pre} src="${escape(next)}"`
    })
}

const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/

export function imageLine(line: string): { alt: string; src: string } | null {
    const m = IMAGE_LINE_RE.exec(line)
    return m ? { alt: m[1], src: m[2] } : null
}
