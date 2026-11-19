import MarkdownIt from 'markdown-it'
import { chapterHeading, docStyle, resolveRefs, type Article, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { compareWords, type DocLang } from './legal-styles'
import { collapseUnchanged, type CompareRow, type InlinePart, type Part } from './article-diff'
import { renderBlock, renderRich, renderRichParts } from './blocks'
import { inlinePropsHtml, propsAttrs, stripInlineProps, type CdProps } from './cd-prop'
import { useMath } from './math'
import { useLocalImages } from './images'
import { t } from './i18n'
import { tocEntries, tocName, type TocEntry } from './toc'

const md = useLocalImages(useMath(new MarkdownIt({ html: false, linkify: false, breaks: true })))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function inline(text: string, doc: LegalDoc): string {
    const resolved = resolveRefs(text, doc, (id) => `[[${id}]]`)
    return inlinePropsHtml(
        md.renderInline(resolved).replace(/\[\[([^\]]+)\]\]/g, (_, id) => `<span class="cd-missing" title="${esc(t().checks.missingTarget)}">[[${id}]]</span>`),
    )
}

let anchors: Map<Article, string> | null = null
const idOf = (a: Article) => {
    const v = a.id ? `art-${a.id}` : anchors?.get(a)
    return v ? ` id="${esc(v)}"` : ''
}

const isLatin = (doc: LegalDoc) => !!doc.styleId && doc.styleId !== 'ja'
const sepOf = (doc: LegalDoc) => (isLatin(doc) ? ' ' : '　')
const num = (label: string, doc: LegalDoc) => (label ? `<span class="cd-num">${esc(label)}</span>${sepOf(doc)}` : '')
const hangText = (doc: LegalDoc) => !isLatin(doc) && doc.config.paragraph.hang === 'text'
const line = (head: string, text: string, doc: LegalDoc) =>
    head && hangText(doc) ? `<span class="cd-lbl">${head}</span><span class="cd-txt">${text}</span>` : `${head}${text}`

function renderItems(items: Item[], doc: LegalDoc): string {
    return items
        .map(
            (it) =>
                `<p${propsAttrs(it.props, `cd-item cd-lv${Math.min(it.level, 4)}`)} data-line="${it.line}">${line(num(it.label, doc), inline(it.text, doc), doc)}</p>` +
                blocks(it.blocks, it.level + 1, it.blockProps) +
                renderItems(it.children, doc),
        )
        .join('')
}

function blocks(list: string[], level: number, props?: (CdProps | undefined)[]): string {
    return list.map((b, i) => `<div class="cd-attach cd-lv${Math.min(level, 4)}">${renderBlock(b, props?.[i])}</div>`).join('')
}

function renderParagraphs(paras: Paragraph[], doc: LegalDoc, head?: string, headHtml?: string): string {
    return paras
        .map((p, idx) => {
            const lead = idx === 0 && headHtml ? headHtml : idx === 0 && head ? `<span class="cd-num">${esc(head)}</span>　` : ''
            const cls = lead ? 'cd-para cd-first' : 'cd-para'
            const body =
                p.text || p.label || lead
                    ? `<p${propsAttrs(p.props, cls)} data-line="${p.line}">${line(`${lead}${num(p.label, doc)}`, inline(p.text, doc), doc)}</p>`
                    : ''
            return `${body}${blocks(p.blocks, 1, p.blockProps)}${renderItems(p.items, doc)}`
        })
        .join('')
}

function renderLatinArticle(a: Article, doc: LegalDoc): string {
    const style = docStyle(doc)
    const id = idOf(a)
    const html = `<div${propsAttrs(a.props, 'cd-article')}${id} data-line="${a.line}">`
    if (a.deleted) {
        return `${html}<p class="cd-para cd-first"><span class="cd-num cd-art-label">${esc(style.headLabel(a.label))}</span> ${esc(style.deletedWord)}</p></div>`
    }
    const showTitle = !!a.title && doc.config.article.title !== 'none'
    const plain = showTitle ? stripInlineProps(resolveRefs(a.title, doc)) : ''
    const label = `<span class="cd-num cd-art-label">${esc(style.headLabel(a.label))}</span>`
    const title = showTitle ? `<span class="cd-art-name">${inline(a.title, doc)}${esc(style.titleSuffix(plain))}</span>` : ''
    if (style.headKind === 'stacked') {
        let out = `${html}<p class="cd-art-head cd-stacked">${label}</p>`
        if (title) out += `<p class="cd-art-title">${title}</p>`
        return `${out}${renderParagraphs(a.paragraphs, doc)}</div>`
    }
    const lead = title ? `${label} ${title}` : label
    const own = style.head(a.label, plain, !!a.paragraphs[0]?.label).runIn === null
    if (own || a.paragraphs.length === 0) return `${html}<p class="cd-art-head">${lead}</p>${renderParagraphs(a.paragraphs, doc)}</div>`
    return `${html}${renderParagraphs(a.paragraphs, doc, undefined, `${lead} `)}</div>`
}

function renderArticle(a: Article, doc: LegalDoc): string {
    if (isLatin(doc)) return renderLatinArticle(a, doc)
    const style = doc.config.article.title
    const id = idOf(a)
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

export interface RenderOptions {
    tocPages?: Map<string, number> | 'placeholder'
    part?: 'all' | 'cover' | 'body'
}

export const TOC_PLACEHOLDER = '000'

function renderToc(doc: LegalDoc, entries: TocEntry[], pages: RenderOptions['tocPages']): string {
    const items = entries
        .filter((e) => !e.deleted)
        .map((e) => {
            const page = pages === 'placeholder' ? TOC_PLACEHOLDER : (pages?.get(e.key)?.toString() ?? '')
            return `<li class="cd-toc-${e.kind}"><a href="#${esc(e.anchor)}"><span class="cd-toc-text">${esc(e.text)}</span><span class="cd-toc-leader"></span><span class="cd-toc-page">${page}</span></a></li>`
        })
        .join('')
    return `<nav class="cd-toc" data-line="${doc.toc!.line}"><p class="cd-toc-title">${esc(tocName(doc.lang))}</p><ol>${items}</ol></nav>`
}

export function renderCover(doc: LegalDoc): string {
    return doc.cover ? `<section class="cd-cover" data-line="${doc.cover.line}">${renderRichParts(doc.cover.parts)}</section>` : ''
}

export function renderDoc(doc: LegalDoc, opts: RenderOptions = {}): string {
    const part = opts.part ?? 'all'
    let html = isLatin(doc)
        ? `<article class="cd-doc cd-latin cd-style-${doc.styleId} cd-lang-${doc.lang}" lang="${doc.lang}">`
        : `<article class="cd-doc cd-indent-${doc.config.paragraph.indent}${doc.config.paragraph.hang === 'text' ? ' cd-hang-text' : ''}">`
    if (part !== 'body') html += renderCover(doc)
    if (part === 'cover') return html + `</article>`
    const entries = doc.toc ? tocEntries(doc) : []
    anchors = doc.toc ? new Map(entries.filter((e) => e.article).map((e) => [e.article!, e.anchor])) : null
    try {
        return renderBody(doc, html, entries, opts)
    } finally {
        anchors = null
    }
}

function renderBody(doc: LegalDoc, start: string, entries: TocEntry[], opts: RenderOptions): string {
    let html = start
    const parts = doc.preambleParts ?? []
    const tocFirst = parts[0]?.toc === true
    if (tocFirst) html += renderToc(doc, entries, opts.tocPages)
    if (doc.title) html += `<h1 class="cd-title">${esc(doc.title)}</h1>`
    const rest = tocFirst ? parts.slice(1) : parts
    if (rest.length)
        html += `<section class="cd-preamble">${rest.map((p) => (p.toc ? renderToc(doc, entries, opts.tocPages) : renderRich(p.md, p.props))).join('')}</section>`
    else if (!doc.preambleParts && doc.preamble) html += `<section class="cd-preamble">${inlinePropsHtml(md.render(doc.preamble))}</section>`
    doc.chapters.forEach((ch, ci) => {
        const chId = doc.toc ? ` id="toc-c${ci}"` : ''
        const body = () => (ch.parts ? renderRichParts(ch.parts) : renderRich(ch.raw))
        if (ch.kind === 'appendix') {
            html += `<section${propsAttrs(ch.props, 'cd-appendix')} data-line="${ch.line}"><h2 class="cd-appendix-title"${chId}>${esc(chapterHeading(ch, doc))}</h2>${body()}</section>`
            return
        }
        if (ch.kind === 'closing') {
            html += `<section${propsAttrs(ch.props, 'cd-closing')} data-line="${ch.line}">${body()}</section>`
            return
        }
        html += `<section${propsAttrs(ch.props, `cd-chapter cd-${ch.kind}`)}>`
        const heading = chapterHeading(ch, doc)
        if (heading) html += `<h2 class="cd-chapter-title"${chId} data-line="${ch.line}">${esc(heading)}</h2>`
        html += renderParagraphs(ch.intro, doc)
        html += ch.articles.map((a) => renderArticle(a, doc)).join('')
        html += `</section>`
    })
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
    const words = compareWords(opts.lang)
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const body = list
        .map((r) =>
            r.status === 'omitted'
                ? `<div class="cd-inline-row cd-omit"><p>${words.omitted}</p></div>`
                : `<div class="cd-inline-row cd-${r.status} cd-row-${r.kind}">${renderInline(r.inline)}</div>`,
        )
        .join('')
    return `<div class="cd-inline">${body}</div>`
}

export interface CompareOptions {
    title?: string
    omitUnchanged?: boolean
    lang?: DocLang
}

export function renderCompareTable(rows: CompareRow[], opts: CompareOptions = {}): string {
    const words = compareWords(opts.lang)
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const body = list
        .map((r) => {
            if (r.status === 'omitted') return `<tr class="cd-omit"><td>${words.omitted}</td><td>${words.omitted}</td></tr>`
            const cls = `cd-${r.status} cd-row-${r.kind}`
            const left = r.status === 'removed' ? `<p>${words.removed}</p>` : renderParts(r.newParts)
            const right = r.status === 'added' ? `<p>${words.added}</p>` : renderParts(r.oldParts)
            return `<tr class="${cls}"><td>${left}</td><td>${right}</td></tr>`
        })
        .join('')
    const caption = opts.title ? `<caption>${esc(opts.title)}</caption>` : ''
    return `<table class="cd-compare">${caption}<thead><tr><th>${words.revised}</th><th>${words.current}</th></tr></thead><tbody>${body}</tbody></table>`
}
