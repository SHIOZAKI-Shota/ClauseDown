import { diffArrays, diffChars } from 'diff'
import { articleLines, chapterHeading, introLines, parseLegal, type LegalDoc } from './legal-parser'
import { appendixLines } from './blocks'

export interface Part {
    text: string
    changed: boolean
}

export interface InlinePart {
    text: string
    op: 'same' | 'add' | 'del'
}

export interface CompareRow {
    status: 'same' | 'changed' | 'added' | 'removed'
    kind: 'chapter' | 'article'
    oldParts: Part[]
    newParts: Part[]
    inline: InlinePart[]
}

export interface Unit {
    key: string
    kind: 'chapter' | 'article'
    label: string
    title: string
    text: string
    line: number
    body: string
}

export function units(doc: LegalDoc): Unit[] {
    const out: Unit[] = []
    for (const ch of doc.chapters) {
        if (ch.kind === 'closing') continue
        if (ch.kind === 'appendix') {
            const text = [chapterHeading(ch), ...appendixLines(ch.raw)].join('\n')
            out.push({ key: `ap:${ch.title}`, kind: 'chapter', label: '', title: ch.title, text, line: ch.line, body: text })
            continue
        }
        const heading = chapterHeading(ch)
        const intro = introLines(ch, doc)
        if (heading || intro.length) {
            const text = [heading, ...intro].filter(Boolean).join('\n')
            out.push({ key: `ch:${ch.kind}:${ch.title}`, kind: 'chapter', label: ch.label, title: ch.title, text, line: ch.line, body: text })
        }
        for (const a of ch.articles) {
            const key = a.id ? `id:${a.id}` : a.title ? `t:${a.title}` : `n:${a.number}.${a.branch}${a.deleted ? ':del' : ''}`
            const text = articleLines(a, doc).join('\n')
            out.push({ key, kind: 'article', label: a.refLabel, title: a.title, text, line: a.line, body: text.replace(a.label, '') })
        }
    }
    return out
}

const LONG_LINE = 2000
const DIFF_TIMEOUT = 100
const DIFF_BUDGET = 1500
let deadline = 0

function push(parts: Part[], text: string, changed: boolean) {
    if (!text) return
    const last = parts.at(-1)
    if (last && last.changed === changed) last.text += text
    else parts.push({ text, changed })
}

function pushInline(parts: InlinePart[], text: string, op: InlinePart['op']) {
    if (!text) return
    const last = parts.at(-1)
    if (last && last.op === op) last.text += text
    else parts.push({ text, op })
}

function diffLine(o: string, n: string, oldParts: Part[], newParts: Part[], inline: InlinePart[]) {
    const timeout = Math.min(DIFF_TIMEOUT, deadline - performance.now())
    const chars = timeout <= 0 || o.length > LONG_LINE || n.length > LONG_LINE ? undefined : diffChars(o, n, { timeout })
    if (!chars) {
        push(oldParts, o, true)
        push(newParts, n, true)
        pushInline(inline, o, 'del')
        pushInline(inline, n, 'add')
        return
    }
    for (const c of chars) {
        if (!c.added) push(oldParts, c.value, !!c.removed)
        if (!c.removed) push(newParts, c.value, !!c.added)
        pushInline(inline, c.value, c.removed ? 'del' : c.added ? 'add' : 'same')
    }
}

function pairRow(o: Unit, n: Unit): CompareRow {
    if (o.text === n.text) {
        const parts = [{ text: o.text, changed: false }]
        return { status: 'same', kind: n.kind, oldParts: parts, newParts: parts, inline: [{ text: n.text, op: 'same' }] }
    }
    const oldParts: Part[] = []
    const newParts: Part[] = []
    const inline: InlinePart[] = []
    const ol = o.text.split('\n')
    const nl = n.text.split('\n')
    let oi = 0
    let ni = 0
    let li = 0
    const sep = (parts: Part[], i: number) => i > 0 && push(parts, '\n', false)
    const line = () => li++ > 0 && pushInline(inline, '\n', 'same')
    const chunks = diffArrays(ol, nl, { timeout: DIFF_TIMEOUT }) ?? [
        { value: ol, count: ol.length, removed: true, added: false },
        { value: nl, count: nl.length, removed: false, added: true },
    ]
    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        if (!chunk.added && !chunk.removed) {
            for (const l of chunk.value) {
                sep(oldParts, oi++)
                sep(newParts, ni++)
                push(oldParts, l, false)
                push(newParts, l, false)
                line()
                pushInline(inline, l, 'same')
            }
            continue
        }
        const rem = chunk.removed ? chunk.value : []
        const add = chunk.removed ? (chunks[c + 1]?.added ? chunks[++c].value : []) : chunk.value
        for (let k = 0; k < Math.max(rem.length, add.length); k++) {
            if (k < rem.length) sep(oldParts, oi++)
            if (k < add.length) sep(newParts, ni++)
            line()
            if (k < rem.length && k < add.length) diffLine(rem[k], add[k], oldParts, newParts, inline)
            else if (k < rem.length) {
                push(oldParts, rem[k], true)
                pushInline(inline, rem[k], 'del')
            } else {
                push(newParts, add[k], true)
                pushInline(inline, add[k], 'add')
            }
        }
    }
    return { status: 'changed', kind: n.kind, oldParts, newParts, inline }
}

function related(o: Unit, n: Unit): boolean {
    if (o.kind !== n.kind) return false
    if (o.title && o.title === n.title) return true
    if (o.label && o.label === n.label && (o.kind === 'chapter' || (!o.title && !n.title))) return true
    const ol = o.text.split('\n')
    const nl = new Set(n.text.split('\n'))
    const common = ol.filter((l) => l && nl.has(l)).length
    return common * 2 >= Math.max(ol.length, nl.size)
}

const PAIR_WINDOW = 20

export interface UnitPair {
    old?: Unit
    new?: Unit
}

export function alignUnits(a: Unit[], b: Unit[]): UnitPair[] {
    const chunks = diffArrays(a, b, { comparator: (x, y) => x.key === y.key })
    const rows: UnitPair[] = []
    let ai = 0
    let bi = 0
    for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        const count = chunk.count ?? chunk.value.length
        if (!chunk.added && !chunk.removed) {
            for (let k = 0; k < count; k++) rows.push({ old: a[ai++], new: b[bi++] })
            continue
        }
        if (chunk.removed && chunks[c + 1]?.added) {
            const next = chunks[c + 1]
            const addEnd = bi + (next.count ?? next.value.length)
            for (let k = 0; k < count; k++) {
                const o = a[ai++]
                let m = bi
                while (m < addEnd && m < bi + PAIR_WINDOW && !related(o, b[m])) m++
                if (m < addEnd && m < bi + PAIR_WINDOW) {
                    while (bi < m) rows.push({ new: b[bi++] })
                    rows.push({ old: o, new: b[bi++] })
                } else rows.push({ old: o })
            }
            while (bi < addEnd) rows.push({ new: b[bi++] })
            c++
            continue
        }
        if (chunk.removed) for (let k = 0; k < count; k++) rows.push({ old: a[ai++] })
        else for (let k = 0; k < count; k++) rows.push({ new: b[bi++] })
    }
    return rows
}

export function compareDocs(oldDoc: LegalDoc, newDoc: LegalDoc): CompareRow[] {
    const a = units(oldDoc)
    const b = units(newDoc)
    deadline = performance.now() + DIFF_BUDGET
    return alignUnits(a, b).map((p) => (p.old && p.new ? pairRow(p.old, p.new) : p.old ? removed(p.old) : added(p.new!)))
}

function removed(u: Unit): CompareRow {
    return { status: 'removed', kind: u.kind, oldParts: [{ text: u.text, changed: true }], newParts: [], inline: [{ text: u.text, op: 'del' }] }
}

function added(u: Unit): CompareRow {
    return { status: 'added', kind: u.kind, oldParts: [], newParts: [{ text: u.text, changed: true }], inline: [{ text: u.text, op: 'add' }] }
}

export function compareSources(oldSrc: string, newSrc: string): CompareRow[] {
    return compareDocs(parseLegal(oldSrc), parseLegal(newSrc))
}

export function collapseUnchanged(rows: CompareRow[]): (CompareRow | { status: 'omitted' })[] {
    const out: (CompareRow | { status: 'omitted' })[] = []
    for (const r of rows) {
        if (r.status === 'same' && r.kind === 'article') {
            if (out.at(-1)?.status !== 'omitted') out.push({ status: 'omitted' })
            continue
        }
        out.push(r)
    }
    return out
}
