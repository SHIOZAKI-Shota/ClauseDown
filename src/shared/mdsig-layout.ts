import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { findSections, linesWithFence, parseDocument, parseScope } from '@mdsig/core'

export interface LineRange {
    from: number
    to: number
}

export interface Coverage {
    index: number
    ranges: LineRange[]
    sections: string[] | null
}

export interface Layout {
    blocks: (LineRange & { index: number })[]
    coverage: Coverage[]
}

export type LockKind = 'free' | 'scoped' | 'full'

export interface Locks {
    kind: LockKind
    lines: LineRange[]
    toEnd: number | null
}

export interface Span {
    from: number
    to: number
}

const lineAt = (text: string, offset: number): number => {
    let n = 1
    for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
    return n
}

const lastContentLine = (lines: string[], from: number, to: number): number => {
    let l = to
    while (l >= from && /^[ \t]*$/.test(lines[l - 1] ?? '')) l--
    return l
}

const newlines = (s: string) => s.match(/\n/g)?.length ?? 0

export function layout(input: string): Layout {
    const doc = parseDocument(input)
    const text = doc.text
    const lines = text.split('\n')
    const blocks = doc.chain.map((b) => ({ index: b.index, from: b.line, to: lineAt(text, b.end - 1) }))
    const coverage = doc.chain.map((b): Coverage => {
        const sections = b.fields.scope ? parseScope(b.fields.scope) : null
        if (sections) {
            const slice = text.slice(0, b.start)
            const found = findSections(slice).sections
            const ranges: LineRange[] = []
            for (const id of sections) {
                const s = found.get(id)
                if (s) ranges.push({ from: s.line, to: s.line + newlines(slice.slice(s.start, s.end)) })
            }
            return { index: b.index, ranges, sections }
        }
        const to = lastContentLine(lines, 1, b.line - 1)
        return { index: b.index, ranges: to >= 1 ? [{ from: 1, to }] : [], sections: null }
    })
    return { blocks, coverage }
}

export function locks(l: Layout): Locks {
    if (!l.blocks.length) return { kind: 'free', lines: [], toEnd: null }
    if (l.coverage.some((c) => c.sections === null)) return { kind: 'full', lines: [], toEnd: null }
    const lines = l.coverage.flatMap((c) => c.ranges).sort((a, b) => a.from - b.from)
    return { kind: 'scoped', lines, toEnd: l.blocks[0].from }
}

export function lockedSpans(lk: Locks, lineStart: (n: number) => number, lineEnd: (n: number) => number, length: number): Span[] {
    if (lk.kind === 'full') return [{ from: 0, to: length }]
    const out: Span[] = lk.lines.map((r) => ({ from: lineStart(r.from), to: lineEnd(r.to) }))
    if (lk.toEnd !== null) out.push({ from: lineStart(lk.toEnd), to: length })
    return out
}

export const touches = (spans: Span[], from: number, to: number): boolean => spans.some((s) => from <= s.to && to >= s.from)

export type FindingKind = 'config' | 'comment' | 'html' | 'chars' | 'linkdef' | 'link' | 'image'

export interface Finding {
    kind: FindingKind
    line: number
    text: string
}

export const FINDING_ORDER: FindingKind[] = ['comment', 'html', 'chars', 'linkdef', 'link', 'image', 'config']

const HIDDEN_RANGES: [number, number][] = [
    [0x00, 0x08],
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x9f],
    [0xad, 0xad],
    [0x61c, 0x61c],
    [0x180e, 0x180e],
    [0x200b, 0x200b],
    [0x200e, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2069],
    [0xfeff, 0xfeff],
]
const isHidden = (c: number) => HIDDEN_RANGES.some(([a, b]) => c >= a && c <= b)
const COMMENT_RE = /<!--([\s\S]*?)-->/g
const SECTION_RE = /^\/?mdsig:section(\s+[a-z0-9-]+)?$/
const CONFIG_RE = /^clausedown\b/
const OPEN_TAG_RE = /<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g
const LINKDEF_RE = /^ {0,3}\[[^\]]+\]:\s*\S/
const DOMAIN_RE = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})/i
const REMOTE_RE = /^(?:https?:)?\/\//i

const md = new MarkdownIt({ html: true, linkify: false })

const codePoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
const clip = (s: string, n = 80) => {
    const one = s.replace(/\s+/g, ' ').trim()
    return one.length > n ? one.slice(0, n) + '…' : one
}
const host = (h: string) => h.toLowerCase().replace(/^www\./, '')

export function linkMismatch(text: string, href: string): boolean {
    const shown = DOMAIN_RE.exec(text)?.[1]
    if (!shown) return false
    try {
        const u = new URL(href)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
        return host(shown) !== host(u.hostname)
    } catch {
        return false
    }
}

function scanHtml(raw: string, line: number, out: Finding[]) {
    const at = (i: number) => line + newlines(raw.slice(0, i))
    for (const m of raw.matchAll(COMMENT_RE)) {
        const body = m[1].trim()
        if (SECTION_RE.test(body)) continue
        out.push({ kind: CONFIG_RE.test(body) ? 'config' : 'comment', line: at(m.index), text: clip(body) || '(empty)' })
    }
    const rest = raw.replace(COMMENT_RE, (c) => ' '.repeat(c.length))
    for (const m of rest.matchAll(OPEN_TAG_RE)) out.push({ kind: 'html', line: at(m.index), text: clip(m[0], 60) })
}

function scanInline(children: Token[], line: number, out: Finding[]) {
    for (let i = 0; i < children.length; i++) {
        const t = children[i]
        if (t.type === 'html_inline') scanHtml(t.content, line, out)
        else if (t.type === 'image') {
            const src = String(t.attrGet('src') ?? '')
            if (REMOTE_RE.test(src)) out.push({ kind: 'image', line, text: src })
        } else if (t.type === 'link_open') {
            const href = String(t.attrGet('href') ?? '')
            let text = ''
            for (let j = i + 1; j < children.length && children[j].type !== 'link_close'; j++) text += children[j].content
            if (linkMismatch(text, href)) out.push({ kind: 'link', line, text: `${clip(text, 40)} → ${href}` })
        }
    }
}

export function scanBody(input: string): Finding[] {
    const doc = parseDocument(input)
    const body = doc.chain.length ? doc.text.slice(0, doc.chain[0].start) : doc.text
    const out: Finding[] = []
    for (const { line, index, inFence } of linesWithFence(body)) {
        for (const ch of line) if (isHidden(ch.codePointAt(0)!)) out.push({ kind: 'chars', line: index + 1, text: codePoint(ch) })
        if (!inFence && LINKDEF_RE.test(line)) out.push({ kind: 'linkdef', line: index + 1, text: clip(line) })
    }
    for (const t of md.parse(body, {})) {
        const line = (t.map?.[0] ?? 0) + 1
        if (t.type === 'html_block') scanHtml(t.content, line, out)
        else if (t.type === 'inline' && t.children) scanInline(t.children, line, out)
    }
    return out.sort((a, b) => a.line - b.line)
}
