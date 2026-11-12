import { inlinePropsHtml, propsAttrs, stripInlineProps, withCols, type CdProps } from './cd-prop'
import MarkdownIt from 'markdown-it'
import type { MarkdownIt as Md, Token } from 'markdown-it'
import { render as renderMermaid } from 'pele'
import { tableSpans, visibleCells } from './table-span'
import { mathError, renderMath, useMath } from './math'

interface CellTokens {
    open: number
    close: number
    text: string
}

export function mergeTableCells(tokens: Token[]): Token[] {
    const drop = new Set<number>()
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type !== 'table_open') continue
        const rows: CellTokens[][] = []
        let cell: CellTokens | null = null
        for (; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
            const t = tokens[i]
            if (t.type === 'tr_open') rows.push([])
            else if (t.type === 'th_open' || t.type === 'td_open') rows.at(-1)?.push((cell = { open: i, close: i, text: '' }))
            else if (t.type === 'inline' && cell) cell.text = t.content
            else if ((t.type === 'th_close' || t.type === 'td_close') && cell) cell.close = i
        }
        const spans = tableSpans(rows.map((r) => r.map((c) => c.text)))
        rows.forEach((r, ri) =>
            r.forEach((c, ci) => {
                const s = spans[ri][ci]
                if (s.hidden) for (let k = c.open; k <= c.close; k++) drop.add(k)
                if (s.colspan > 1) tokens[c.open].attrSet('colspan', String(s.colspan))
                if (s.rowspan > 1) tokens[c.open].attrSet('rowspan', String(s.rowspan))
            }),
        )
    }
    return drop.size ? tokens.filter((_, k) => !drop.has(k)) : tokens
}

export function useTableSpans(m: Md): Md {
    m.core.ruler.push('cd_table_spans', (state) => {
        state.tokens = mergeTableCells(state.tokens)
    })
    return m
}

const md = useMath(useTableSpans(new MarkdownIt({ html: false, linkify: false, breaks: true })))
const plainMd = new MarkdownIt({ html: false, linkify: false, breaks: true })

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const FENCE_RE = /^(`{3,}|~{3,})\s*([\w-]*)[^\n]*\n([\s\S]*?)\n?\1\s*$/

export interface Fence {
    lang: string
    body: string
}

export function parseFence(raw: string): Fence | null {
    const m = FENCE_RE.exec(raw.trim())
    return m ? { lang: m[2].toLowerCase(), body: m[3] } : null
}

type Figure = { svg: string; width: number; height: number; error?: string }

function hash(s: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
    return (h >>> 0).toString(36)
}

const figureMemo = new Map<string, Figure>()

export function mermaidSvg(body: string): Figure {
    const hit = figureMemo.get(body)
    if (hit) return hit
    const r = drawMermaid(body)
    if (figureMemo.size >= 100) figureMemo.delete(figureMemo.keys().next().value!)
    figureMemo.set(body, r)
    return r
}

function drawMermaid(body: string): Figure {
    try {
        const { svg, width, height } = renderMermaid(body, {
            idPrefix: `cd-fig-${hash(body)}-`,
            maxWidth: 620,
            autoDirection: true,
            fontFamily: '"Yu Gothic UI", "Meiryo UI", "Hiragino Sans", sans-serif',
        })
        return { svg, width, height }
    } catch (e) {
        return { svg: '', width: 0, height: 0, error: (e as Error).message }
    }
}

export function renderBlock(raw: string, props?: CdProps): string {
    const fence = parseFence(raw)
    if (fence?.lang === 'mermaid') {
        const { svg, error } = mermaidSvg(fence.body)
        if (error) return `<div class="cd-figure cd-figure-error">図を描けません：${esc(error)}<pre>${esc(fence.body)}</pre></div>`
        return `<figure${propsAttrs(props, 'cd-figure')}>${svg}</figure>`
    }
    if (fence?.lang === 'math') {
        const error = mathError(fence.body, true)
        if (error) return `<div class="cd-figure cd-figure-error">数式を描けません：${esc(error)}<pre>${esc(fence.body)}</pre></div>`
        return `<div${propsAttrs(props, 'cd-math-block')}>${renderMath(fence.body, true)}</div>`
    }
    return `<div${propsAttrs(props, 'cd-block')}>${withCols(inlinePropsHtml(md.render(raw)), props)}</div>`
}

export function renderRich(raw: string, props?: CdProps): string {
    const out: string[] = []
    const re = /^(`{3,}|~{3,})\s*mermaid[^\n]*\n[\s\S]*?\n\1\s*$/gim
    let last = 0
    for (const m of raw.matchAll(re)) {
        out.push(inlinePropsHtml(md.render(raw.slice(last, m.index))))
        out.push(renderBlock(m[0]))
        last = m.index! + m[0].length
    }
    out.push(inlinePropsHtml(md.render(raw.slice(last))))
    const html = withCols(out.join(''), props)
    return props ? `<div${propsAttrs(props)}>${html}</div>` : html
}

export function renderRichParts(parts: { md: string; props?: CdProps }[]): string {
    return parts.map((p) => renderRich(p.md, p.props)).join('')
}

export function parseTable(raw: string): string[][] | null {
    const tokens = plainMd.parse(raw, {})
    if (!tokens.some((t) => t.type === 'table_open')) return null
    const rows: string[][] = []
    let row: string[] | null = null
    for (const t of tokens) {
        if (t.type === 'tr_open') row = []
        else if (t.type === 'tr_close' && row) rows.push(row)
        else if (t.type === 'inline' && row) row.push(stripInlineProps(t.content).replace(/(\*\*|__|`)/g, ''))
    }
    return rows
}

export function blockLines(raw: string): string[] {
    const fence = parseFence(raw)
    if (fence) {
        const head = fence.lang === 'mermaid' ? '［図］' : fence.lang === 'math' ? '［数式］' : '［囲み］'
        return [
            head,
            ...fence.body
                .split('\n')
                .map((l) => `　${l.trim()}`)
                .filter((l) => l.trim()),
        ]
    }
    const rows = parseTable(raw)
    if (rows) return ['［表］', ...visibleCells(rows).map((r) => `　${r.join('｜')}`)]
    return raw.split('\n').filter((l) => l.trim())
}

export function appendixLines(raw: string): string[] {
    const out: string[] = []
    const re = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\s*$|^(?:\|.*\|\s*\n?)+/gm
    let last = 0
    for (const m of raw.matchAll(re)) {
        out.push(
            ...raw
                .slice(last, m.index)
                .split('\n')
                .filter((l) => l.trim()),
        )
        out.push(...blockLines(m[0]))
        last = m.index! + m[0].length
    }
    out.push(
        ...raw
            .slice(last)
            .split('\n')
            .filter((l) => l.trim()),
    )
    return out
}
