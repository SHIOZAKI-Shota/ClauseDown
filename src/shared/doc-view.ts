import { parseLegal, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { mermaidSvg, parseFence } from './blocks'
import { checkDefinitions } from './definitions'
import { formatNumber, type NumeralStyle } from './numerals'

const branchSuffix = (path: number[] | undefined, style: NumeralStyle) =>
    (path ?? []).map((b) => `の${formatNumber(b, style)}`).join('')

export function lineLabels(doc: LegalDoc): Map<number, string> {
    const out = new Map<number, string>()
    const style = doc.config.article.numeral as NumeralStyle
    const itemStyle: NumeralStyle = doc.config.item.style === 'kanji' ? 'kanji' : style
    const items = (list: Item[], prefix: string) => {
        for (const it of list) {
            const own = it.level === 1 ? `第${formatNumber(it.number, itemStyle)}号${branchSuffix(it.branchPath, itemStyle)}` : it.label
            const label = `${prefix}${own}`
            if (it.line >= 0) out.set(it.line, label)
            items(it.children, label)
        }
    }
    const paras = (list: Paragraph[], article: string) => {
        for (const p of list) {
            const label = `${article}第${formatNumber(p.number, style)}項${branchSuffix(p.branchPath, style)}`
            if (p.line >= 0) out.set(p.line, label)
            items(p.items, label)
        }
    }
    for (const ch of doc.chapters) {
        if (ch.line >= 0) out.set(ch.line, ch.label ? `${ch.label}${ch.title ? ` ${ch.title}` : ''}` : ch.title || '')
        paras(ch.intro, ch.label)
        for (const a of ch.articles) {
            out.set(a.line, a.deleted ? `${a.refLabel} 削除` : a.refLabel)
            paras(a.paragraphs, a.refLabel)
        }
    }
    return out
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

const REF_RE = /\[\[([^\]:]+)(?::\d+)?(?::\d+)?\]\]/g

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
        if (!doc.refs[r[1].trim()]) out.push({ line: lineOf(r.index!), severity: 'error', message: `条参照「${r[0]}」の参照先（{#${r[1].trim()}}）がありません` })
    }
    for (const f of source.matchAll(/^[ \t]*(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)) {
        const fence = parseFence(f[0].replace(/^[ \t]+/gm, ''))
        if (!fence) continue
        const { error } = mermaidSvg(fence.body)
        if (error) out.push({ line: lineOf(f.index!), severity: 'warning', message: `図を描けません：${error}` })
    }
    for (const d of checkDefinitions(source)) out.push({ line: d.line, severity: 'error', message: `定義語：${d.message}` })
    for (const w of doc.warnings) {
        const m = /^(\d+)行目/.exec(w)
        out.push({ line: m ? Number(m[1]) : 0, severity: 'warning', message: w })
    }
    if (!doc.title) out.push({ line: 1, severity: 'warning', message: '文書タイトル（# の行）がありません' })
    for (const ch of doc.chapters) {
        for (const a of ch.articles) {
            if (!a.deleted && !a.paragraphs.some((p) => p.text.trim() || p.items.length)) {
                out.push({ line: a.line + 1, severity: 'warning', message: `${a.refLabel}に本文がありません` })
            }
        }
    }
    return out.sort((a, b) => a.line - b.line)
}
