import MarkdownIt from 'markdown-it'
import { chapterHeading, resolveRefs, type Article, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { collapseUnchanged, type CompareRow, type InlinePart, type Part } from './article-diff'
import { renderBlock, renderRich, renderRichParts } from './blocks'
import { inlinePropsHtml, propsAttrs, type CdProps } from './cd-prop'
import { useMath } from './math'

const md = useMath(new MarkdownIt({ html: false, linkify: false, breaks: true }))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function inline(text: string, doc: LegalDoc): string {
    const resolved = resolveRefs(text, doc, (id) => `[[${id}]]`)
    return inlinePropsHtml(
        md.renderInline(resolved).replace(/\[\[([^\]]+)\]\]/g, (_, id) => `<span class="cd-missing" title="参照先の条が見つかりません">[[${id}]]</span>`),
    )
}

const num = (label: string) => (label ? `<span class="cd-num">${esc(label)}</span>　` : '')

function renderItems(items: Item[], doc: LegalDoc): string {
    return items
        .map(
            (it) =>
                `<p${propsAttrs(it.props, `cd-item cd-lv${Math.min(it.level, 4)}`)} data-line="${it.line}">${num(it.label)}${inline(it.text, doc)}</p>` +
                blocks(it.blocks, it.level + 1, it.blockProps) +
                renderItems(it.children, doc),
        )
        .join('')
}

function blocks(list: string[], level: number, props?: (CdProps | undefined)[]): string {
    return list.map((b, i) => `<div class="cd-attach cd-lv${Math.min(level, 4)}">${renderBlock(b, props?.[i])}</div>`).join('')
}

function renderParagraphs(paras: Paragraph[], doc: LegalDoc, head?: string): string {
    return paras
        .map((p, idx) => {
            const lead = idx === 0 && head ? `<span class="cd-num">${esc(head)}</span>　` : ''
            const cls = lead ? 'cd-para cd-first' : 'cd-para'
            const body = p.text || p.label || lead ? `<p${propsAttrs(p.props, cls)} data-line="${p.line}">${lead}${num(p.label)}${inline(p.text, doc)}</p>` : ''
            return `${body}${blocks(p.blocks, 1, p.blockProps)}${renderItems(p.items, doc)}`
        })
        .join('')
}

function renderArticle(a: Article, doc: LegalDoc): string {
    const style = doc.config.article.title
    const id = a.id ? ` id="art-${esc(a.id)}"` : ''
    let html = `<div${propsAttrs(a.props, 'cd-article')}${id} data-line="${a.line}">`
    if (a.deleted) {
        return `${html}<p class="cd-para cd-first"><span class="cd-num">${esc(a.label)}</span>　削除</p></div>`
    }
    if (style === 'above' && a.title) html += `<p class="cd-art-title">（${inline(a.title, doc)}）</p>`
    if (style === 'inline' && a.title) {
        html += `<p class="cd-art-head"><span class="cd-num">${esc(a.label)}</span>（${inline(a.title, doc)}）</p>`
        html += renderParagraphs(a.paragraphs, doc)
    } else if (a.paragraphs.length === 0) {
        html += `<p class="cd-para cd-first"><span class="cd-num">${esc(a.label)}</span></p>`
    } else {
        html += renderParagraphs(a.paragraphs, doc, a.label)
    }
    return html + '</div>'
}

export function renderDoc(doc: LegalDoc): string {
    let html = `<article class="cd-doc cd-indent-${doc.config.paragraph.indent}">`
    if (doc.title) html += `<h1 class="cd-title">${esc(doc.title)}</h1>`
    if (doc.preamble)
        html += `<section class="cd-preamble">${doc.preambleParts ? renderRichParts(doc.preambleParts) : inlinePropsHtml(md.render(doc.preamble))}</section>`
    for (const ch of doc.chapters) {
        const body = () => (ch.parts ? renderRichParts(ch.parts) : renderRich(ch.raw))
        if (ch.kind === 'appendix') {
            html += `<section${propsAttrs(ch.props, 'cd-appendix')} data-line="${ch.line}"><h2 class="cd-appendix-title">${esc(chapterHeading(ch))}</h2>${body()}</section>`
            continue
        }
        if (ch.kind === 'closing') {
            html += `<section${propsAttrs(ch.props, 'cd-closing')} data-line="${ch.line}">${body()}</section>`
            continue
        }
        html += `<section${propsAttrs(ch.props, `cd-chapter cd-${ch.kind}`)}>`
        const heading = chapterHeading(ch)
        if (heading) html += `<h2 class="cd-chapter-title" data-line="${ch.line}">${esc(heading)}</h2>`
        html += renderParagraphs(ch.intro, doc)
        html += ch.articles.map((a) => renderArticle(a, doc)).join('')
        html += `</section>`
    }
    return html + `</article>`
}

function renderParts(parts: Part[]): string {
    const lines: string[] = ['']
    for (const p of parts) {
        const segs = p.text.split('\n')
        segs.forEach((s, i) => {
            if (i > 0) lines.push('')
            if (s) lines[lines.length - 1] += p.changed ? `<u class="cd-chg">${esc(s)}</u>` : esc(s)
        })
    }
    return lines.map((l) => `<p>${l || '&nbsp;'}</p>`).join('')
}

function renderInline(parts: InlinePart[]): string {
    const lines: string[] = ['']
    for (const p of parts) {
        p.text.split('\n').forEach((s, i) => {
            if (i > 0) lines.push('')
            if (!s) return
            const t = esc(s)
            lines[lines.length - 1] += p.op === 'add' ? `<ins class="cd-ins">${t}</ins>` : p.op === 'del' ? `<del class="cd-del">${t}</del>` : t
        })
    }
    return lines.map((l) => `<p>${l || '&nbsp;'}</p>`).join('')
}

export function renderInlineDiff(rows: CompareRow[], opts: CompareOptions = {}): string {
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const body = list
        .map((r) =>
            r.status === 'omitted'
                ? '<div class="cd-inline-row cd-omit"><p>（略）</p></div>'
                : `<div class="cd-inline-row cd-${r.status} cd-row-${r.kind}">${renderInline(r.inline)}</div>`,
        )
        .join('')
    return `<div class="cd-inline">${body}</div>`
}

export interface CompareOptions {
    title?: string
    omitUnchanged?: boolean
}

export function renderCompareTable(rows: CompareRow[], opts: CompareOptions = {}): string {
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const body = list
        .map((r) => {
            if (r.status === 'omitted') return `<tr class="cd-omit"><td>（略）</td><td>（略）</td></tr>`
            const cls = `cd-${r.status} cd-row-${r.kind}`
            const left = r.status === 'removed' ? '<p>（削る）</p>' : renderParts(r.newParts)
            const right = r.status === 'added' ? '<p>（新設）</p>' : renderParts(r.oldParts)
            return `<tr class="${cls}"><td>${left}</td><td>${right}</td></tr>`
        })
        .join('')
    const caption = opts.title ? `<caption>${esc(opts.title)}</caption>` : ''
    return `<table class="cd-compare">${caption}<thead><tr><th>改正後</th><th>改正前</th></tr></thead><tbody>${body}</tbody></table>`
}
