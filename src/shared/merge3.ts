import { diffArrays } from 'diff'
import { articleTitle, parseLegal, type LegalDoc } from './legal-parser'

export const splitLines = (s: string) => s.replace(/\r\n/g, '\n').split('\n')

export interface Hunk {
    id: number
    base: string[]
    ours: string[]
    theirs: string[]
    oursLine: number
    where: string
}

export type MergePart = { kind: 'ok'; lines: string[] } | { kind: 'conflict'; hunk: Hunk }

export interface MergeResult {
    parts: MergePart[]
    hunks: Hunk[]
    clean: boolean
}

export function whereIs(doc: LegalDoc, line: number): string {
    let label = doc.preamble || doc.title ? '前文・題名' : ''
    for (const ch of doc.chapters) {
        if (ch.line >= 0 && ch.line <= line) {
            label = ch.kind === 'appendix' || ch.kind === 'closing' ? ch.title || '別表' : [ch.label, ch.title].filter(Boolean).join('　') || label
        }
        for (const a of ch.articles) {
            if (a.line <= line) label = `${a.refLabel}${a.title ? `（${articleTitle(a, doc)}）` : ''}`
        }
    }
    return label || '文書の先頭'
}

interface Edit {
    oStart: number
    oEnd: number
    xStart: number
    xEnd: number
    side: 0 | 1
}

function editsOf(base: string[], x: string[], side: 0 | 1): Edit[] {
    const out: Edit[] = []
    let o = 0
    let p = 0
    let cur: Edit | null = null
    for (const c of diffArrays(base, x)) {
        const n = c.count ?? c.value.length
        if (!c.added && !c.removed) {
            if (cur) out.push(cur)
            cur = null
            o += n
            p += n
            continue
        }
        cur ??= { oStart: o, oEnd: o, xStart: p, xEnd: p, side }
        if (c.removed) cur.oEnd = o += n
        else cur.xEnd = p += n
    }
    if (cur) out.push(cur)
    return out
}

const append = (dst: string[], src: string[], from = 0, to = src.length) => {
    for (let i = from; i < to; i++) dst.push(src[i])
}

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i])

export function merge3(base: string, ours: string, theirs: string): MergeResult {
    const o = splitLines(base)
    const sides = [splitLines(ours), splitLines(theirs)]
    const edits = [...editsOf(o, sides[0], 0), ...editsOf(o, sides[1], 1)].sort((x, y) => x.oStart - y.oStart || x.side - y.side)
    let oursDoc: LegalDoc | null = null
    const parts: MergePart[] = []
    const hunks: Hunk[] = []
    let ok: string[] | null = null
    const okLines = () => {
        if (!ok) parts.push({ kind: 'ok', lines: (ok = []) })
        return ok
    }
    let pos = 0
    let oursPos = 0
    for (let i = 0; i < edits.length;) {
        const start = edits[i].oStart
        let end = edits[i].oEnd
        const first: (Edit | undefined)[] = [undefined, undefined]
        const last: (Edit | undefined)[] = [undefined, undefined]
        for (; i < edits.length && edits[i].oStart <= end; i++) {
            const e = edits[i]
            end = Math.max(end, e.oEnd)
            first[e.side] ??= e
            last[e.side] = e
        }
        append(okLines(), o, pos, start)
        oursPos += start - pos
        const content = [0, 1].map((s) => {
            const f = first[s]
            const l = last[s]
            if (!f || !l) return o.slice(start, end)
            return sides[s].slice(f.xStart - (f.oStart - start), l.xEnd + (end - l.oEnd))
        })
        if (!first[0] || !first[1] || sameLines(content[0], content[1])) {
            append(okLines(), first[1] && !first[0] ? content[1] : content[0])
        } else {
            oursDoc ??= parseLegal(ours)
            const hunk: Hunk = {
                id: hunks.length,
                base: o.slice(start, end),
                ours: content[0],
                theirs: content[1],
                oursLine: oursPos,
                where: whereIs(oursDoc, Math.max(0, oursPos + (content[0].length ? 0 : -1))),
            }
            hunks.push(hunk)
            parts.push({ kind: 'conflict', hunk })
            ok = null
        }
        oursPos += content[0].length
        pos = end
    }
    if (pos < o.length || !parts.length) append(okLines(), o, pos)
    return { parts, hunks, clean: hunks.length === 0 }
}

export type HunkChoice = 'ours' | 'theirs' | 'oursThenTheirs' | 'theirsThenOurs' | 'base' | 'custom'

export function linesFor(h: Hunk, choice: HunkChoice, custom?: string): string[] {
    switch (choice) {
        case 'ours':
            return h.ours
        case 'theirs':
            return h.theirs
        case 'oursThenTheirs':
            return [...h.ours, ...h.theirs]
        case 'theirsThenOurs':
            return [...h.theirs, ...h.ours]
        case 'base':
            return h.base
        case 'custom':
            return custom ? splitLines(custom) : []
    }
}

export interface HunkResolution {
    choice: HunkChoice
    text?: string
}

export function applyResolutions(result: MergeResult, res: Record<number, HunkResolution | undefined>): string | null {
    const out: string[] = []
    for (const p of result.parts) {
        if (p.kind === 'ok') append(out, p.lines)
        else {
            const r = res[p.hunk.id]
            if (!r) return null
            append(out, linesFor(p.hunk, r.choice, r.text))
        }
    }
    return out.join('\n')
}

export function autoMerge(base: string, ours: string, theirs: string): string | null {
    const r = merge3(base, ours, theirs)
    return r.clean ? r.parts.map((p) => (p.kind === 'ok' ? p.lines.join('\n') : '')).join('\n') : null
}
