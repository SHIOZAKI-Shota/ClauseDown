import { docStyle, parseLegal, REF_RE, warningLine, type Article, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { mermaidSvg, parseFence } from './blocks'
import { checkDefinitions } from './definitions'
import { formatNumber, type NumeralStyle } from './numerals'
import type { RefTarget } from './legal-styles'
import { t } from './i18n'

const branchSuffix = (path: number[] | undefined, style: NumeralStyle) => (path ?? []).map((b) => `の${formatNumber(b, style)}`).join('')

interface LineInfo {
    label: string
    article?: Article
}

function lineInfo(doc: LegalDoc): Map<number, LineInfo> {
    return doc.styleId && doc.styleId !== 'ja' ? latinLineInfo(doc) : jaLineInfo(doc)
}

function jaLineInfo(doc: LegalDoc): Map<number, LineInfo> {
    const out = new Map<number, LineInfo>()
    const style = doc.config.article.numeral as NumeralStyle
    const itemStyle: NumeralStyle = doc.config.item.style === 'kanji' ? 'kanji' : style
    const items = (list: Item[], prefix: string, article?: Article) => {
        for (const it of list) {
            const own = it.level === 1 ? `第${formatNumber(it.number, itemStyle)}号${branchSuffix(it.branchPath, itemStyle)}` : it.label
            const label = `${prefix}${own}`
            if (it.line >= 0) out.set(it.line, { label, article })
            items(it.children, label, article)
        }
    }
    const paras = (list: Paragraph[], prefix: string, article?: Article) => {
        for (const p of list) {
            const label = `${prefix}第${formatNumber(p.number, style)}項${branchSuffix(p.branchPath, style)}`
            if (p.line >= 0) out.set(p.line, { label, article })
            items(p.items, label, article)
        }
    }
    for (const ch of doc.chapters) {
        if (ch.line >= 0) out.set(ch.line, { label: ch.label ? `${ch.label}${ch.title ? ` ${ch.title}` : ''}` : ch.title || '' })
        paras(ch.intro, ch.label)
        for (const a of ch.articles) {
            out.set(a.line, { label: a.deleted ? `${a.refLabel} 削除` : a.refLabel, article: a })
            paras(a.paragraphs, a.refLabel, a)
        }
    }
    return out
}

function latinLineInfo(doc: LegalDoc): Map<number, LineInfo> {
    const out = new Map<number, LineInfo>()
    const style = docStyle(doc)
    const items = (list: Item[], base: Omit<RefTarget, 'items'>, chain: RefTarget['items'], article?: Article) => {
        for (const it of list) {
            const next = [...chain, { number: it.number, level: it.level, label: it.label }]
            const label = base.articleRef ? style.ref({ ...base, items: next }, doc.config) : next.map((x) => x.label).join('')
            if (it.line >= 0) out.set(it.line, { label, article })
            items(it.children, base, next, article)
        }
    }
    for (const ch of doc.chapters) {
        const head = ch.label ? `${ch.label}${ch.title ? ` ${ch.title}` : ''}` : ch.title || ''
        if (ch.line >= 0) out.set(ch.line, { label: head })
        ch.intro.forEach((p) => {
            const label = [ch.label, p.label].filter(Boolean).join(' ')
            if (p.line >= 0) out.set(p.line, { label })
            items(p.items, { article: { number: 0, branch: 0 }, articleRef: '' }, [], undefined)
        })
        for (const a of ch.articles) {
            out.set(a.line, { label: a.deleted ? style.deletedLine(a.refLabel) : a.refLabel, article: a })
            a.paragraphs.forEach((p, index) => {
                const base = { article: a, articleRef: a.refLabel, paragraph: { number: p.number, label: p.label, index, count: a.paragraphs.length } }
                if (p.line >= 0) out.set(p.line, { label: style.ref({ ...base, items: [] }, doc.config), article: a })
                items(p.items, base, [], a)
            })
        }
    }
    return out
}

export function lineLabels(doc: LegalDoc): Map<number, string> {
    return new Map([...lineInfo(doc)].map(([line, info]) => [line, info.label]))
}

export function numberedText(input: string): string {
    const source = input.replace(/\r\n?/g, '\n')
    const doc = parseLegal(source)
    const labels = lineLabels(doc)
    const lines = source.split('\n')
    const width = String(lines.length).length
    return lines
        .map((l, i) => {
            const label = labels.get(i)
            return `${String(i + 1).padStart(width)}| ${label ? `〔${label}〕` : ''}${l}`
        })
        .join('\n')
}

export interface DocIssue {
    line: number
    severity: 'error' | 'warning'
    message: string
}

export interface BackRef {
    line: number
    label: string
    article: string
}

export function backRefs(input: string, doc: LegalDoc): Map<number, BackRef[]> {
    const labels = [...lineInfo(doc)].sort((a, b) => a[0] - b[0])
    const before = <T>(list: T[], line: number, at: (x: T) => number): T | undefined => {
        let hit: T | undefined
        for (const x of list) {
            if (at(x) > line) break
            hit = x
        }
        return hit
    }
    const out = new Map<number, BackRef[]>()
    input
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .forEach((text, line) => {
            for (const r of text.matchAll(REF_RE)) {
                const target = doc.refs[r[1].trim()]
                if (!target || target.line < 0) continue
                const info = before(labels, line, (l) => l[0])?.[1]
                const label = info?.label || t().checks.preamble
                const own = info?.article
                if (own === target) continue
                const list = out.get(target.line) ?? []
                if (!list.some((b) => b.line === line)) list.push({ line, label, article: own?.refLabel ?? label })
                out.set(target.line, list)
            }
        })
    return out
}

export function checkDoc(input: string): DocIssue[] {
    const source = input.replace(/\r\n?/g, '\n')
    const doc = parseLegal(source)
    const out: DocIssue[] = []
    const starts = [0]
    for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1)
    const lineOf = (index: number) => {
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= index) lo = mid
            else hi = mid - 1
        }
        return lo + 1
    }
    for (const r of source.matchAll(REF_RE)) {
        if (r[0] === '[[_TOC_]]' && doc.toc && lineOf(r.index) === doc.toc.line + 1) continue
        if (!doc.refs[r[1].trim()]) out.push({ line: lineOf(r.index), severity: 'error', message: t().checks.missingRef(r[0], r[1].trim()) })
    }
    for (const f of source.matchAll(/^[ \t]*(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)) {
        const fence = parseFence(f[0].replace(/^[ \t]+/gm, ''))
        if (!fence) continue
        const { error } = mermaidSvg(fence.body)
        if (error) out.push({ line: lineOf(f.index), severity: 'warning', message: t().checks.figureError(error) })
    }
    for (const d of checkDefinitions(source)) out.push({ line: d.line, severity: 'error', message: t().checks.definition(d.message) })
    for (const w of doc.warnings) {
        out.push({ line: warningLine(w), severity: 'warning', message: w })
    }
    if (!doc.title) out.push({ line: 1, severity: 'warning', message: t().checks.noTitle })
    for (const ch of doc.chapters) {
        for (const a of ch.articles) {
            if (!a.deleted && !a.paragraphs.some((p) => p.text.trim() || p.items.length)) {
                out.push({ line: a.line + 1, severity: 'warning', message: t().checks.emptyArticle(a.refLabel) })
            }
        }
    }
    return out.sort((a, b) => a.line - b.line)
}
