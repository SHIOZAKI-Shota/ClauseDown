import { parseLegal, type Article, type LegalDoc } from './legal-parser'

export interface ClauseRef {
    id: string
    title: string
}

export interface Clause {
    key: string
    docPath: string
    docTitle: string
    id?: string
    title: string
    label: string
    body: string
    refs: ClauseRef[]
}

export type RefChoice = { kind: 'article'; index: number } | { kind: 'text' } | { kind: 'keep' }

export interface ClauseInsert {
    block: string
    lineEdits: { line: number; text: string }[]
}

const REF_RE = /\[\[([^\]:]+)((?::\d+){0,2})\]\]/g
const ATTR_RE = /\s\{([^{}]*)\}\s*$/

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const targetArticles = (doc: LegalDoc): Article[] => doc.chapters.flatMap((c) => c.articles).filter((a) => !a.deleted)

function boundaries(doc: LegalDoc): number[] {
    const out: number[] = []
    for (const ch of doc.chapters) {
        if (ch.line >= 0) out.push(ch.line)
        for (const a of ch.articles) out.push(a.line)
    }
    return out.sort((a, b) => a - b)
}

function articleEnd(lines: string[], bounds: number[], start: number): number {
    const next = bounds.find((b) => b > start) ?? lines.length
    let last = next - 1
    while (last > start && !lines[last].trim()) last--
    return last
}

export function extractClauses(source: string, docPath: string, docTitle: string): Clause[] {
    const doc = parseLegal(source)
    const lines = source.replace(/\r\n/g, '\n').split('\n')
    const bounds = boundaries(doc)
    return targetArticles(doc).map((a, i) => {
        const body = lines.slice(a.line, articleEnd(lines, bounds, a.line) + 1).join('\n')
        const ids = new Set<string>()
        for (const m of body.matchAll(REF_RE)) ids.add(m[1].trim())
        if (a.id) ids.delete(a.id)
        return {
            key: `${docPath}#${i}`,
            docPath,
            docTitle,
            id: a.id,
            title: a.title,
            label: a.label,
            body,
            refs: [...ids].map((id) => ({ id, title: doc.refs[id]?.title ?? '' })),
        }
    })
}

export function defaultChoice(ref: ClauseRef, target: LegalDoc): RefChoice {
    const list = targetArticles(target)
    const byId = list.findIndex((a) => a.id === ref.id)
    if (byId >= 0) return { kind: 'article', index: byId }
    const byTitle = ref.title ? list.findIndex((a) => a.title === ref.title) : -1
    if (byTitle >= 0) return { kind: 'article', index: byTitle }
    return { kind: 'text' }
}

export function withHeadingId(line: string, id: string): string {
    const m = ATTR_RE.exec(line)
    if (!m) return `${line.replace(/\s+$/, '')} {#${id}}`
    const at = m.index + m[0].indexOf('{') + 1
    return `${line.slice(0, at)}#${id}${m[1].trim() ? ' ' : ''}${line.slice(at)}`
}

function uniqueId(base: string, used: Set<string>): string {
    let id = base
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`
    used.add(id)
    return id
}

export function applyClause(clause: Clause, target: LegalDoc, targetLines: string[], choices: Record<string, RefChoice>): ClauseInsert {
    const used = new Set(Object.keys(target.refs))
    const list = targetArticles(target)
    const renames = new Map<string, string>()
    const lineEdits: ClauseInsert['lineEdits'] = []
    const assigned = new Map<number, string>()
    let block = clause.body

    if (clause.id && used.has(clause.id)) {
        const next = uniqueId(clause.id, used)
        renames.set(clause.id, next)
        block = block.replace(new RegExp(`\\{#${esc(clause.id)}\\b`), `{#${next}`)
    } else if (clause.id) used.add(clause.id)

    for (const ref of clause.refs) {
        const c = choices[ref.id] ?? { kind: 'keep' }
        if (c.kind === 'article') {
            const a = list[c.index]
            if (!a) continue
            let id = a.id ?? assigned.get(c.index)
            if (!id) {
                id = uniqueId(ref.id, used)
                assigned.set(c.index, id)
                lineEdits.push({ line: a.line, text: withHeadingId(targetLines[a.line] ?? '', id) })
            }
            renames.set(ref.id, id)
        } else if (c.kind === 'text') {
            const words = ref.title ? `${ref.title}の条` : 'ほかの条'
            block = block.replace(new RegExp(`\\[\\[${esc(ref.id)}((?::\\d+){0,2})\\]\\]`, 'g'), words)
        }
    }

    block = block.replace(REF_RE, (whole, id: string, rest: string) => {
        const next = renames.get(id.trim())
        return next ? `[[${next}${rest}]]` : whole
    })
    return { block, lineEdits }
}

export function clauseInsertLine(doc: LegalDoc, lines: string[], cursor: number): number {
    const articleLines = new Set(doc.chapters.flatMap((c) => c.articles.map((a) => a.line)))
    const bounds = boundaries(doc)
    const here = [...bounds].reverse().find((b) => b <= cursor)
    if (here === undefined || !articleLines.has(here)) return Math.min(cursor, lines.length - 1)
    return articleEnd(lines, bounds, here)
}
