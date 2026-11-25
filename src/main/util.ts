import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const shortId = (length = 12): string => [...randomBytes(length)].map((x) => ID_CHARS[x % ID_CHARS.length]).join('')

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

export function safeFileName(s: string, fallback = '_'): string {
    let out = ''
    for (let i = 0; i < s.length; i++) out += s.charCodeAt(i) < 0x20 || '\\/:*?"<>|'.includes(s[i]) ? '_' : s[i]
    out = out.trim().replace(/[. ]+$/, '')
    return RESERVED.test(out) ? `${out}_` : out || fallback
}

export function uniquePath(folder: string, stem: string, ext = ''): string {
    const dot = ext ? `.${ext}` : ''
    let out = join(folder, `${stem}${dot}`)
    for (let i = 2; existsSync(out); i++) out = join(folder, `${stem} (${i})${dot}`)
    return out
}
