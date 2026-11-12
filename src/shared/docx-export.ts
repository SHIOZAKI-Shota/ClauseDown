import {
    AlignmentType,
    BorderStyle,
    Document,
    ImageRun,
    LineRuleType,
    Packer,
    Paragraph as DocxParagraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    VerticalAlign,
    WidthType,
    type ISectionOptions,
} from 'docx'
import MarkdownIt from 'markdown-it'
import { chapterHeading, resolveRefs, type Article, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { collapseUnchanged, type CompareRow, type Part } from './article-diff'
import { parseFence, parseTable } from './blocks'
import type { DocStyle } from './prefs'
import { inlineRuns, mergeProps, type CdProps } from './cd-prop'
import { tableSpans } from './table-span'
import { imageLine } from './images'
import { displayLine, mathKey, useMath } from './math'

export type Figures = Map<string, { png: Uint8Array; width: number; height: number }>
export type Images = Map<string, { data: Uint8Array; type: 'png' | 'jpg' | 'gif'; width: number; height: number }>

type Block = DocxParagraph | Table

interface Ctx {
    doc: LegalDoc
    figures?: Figures
    images?: Images
    width: number
}

const A4_SHORT = 11906
const A4_LONG = 16838
const DEFAULT_MARGIN = 25.4
const marginTwip = (style?: DocStyle) => Math.round((style?.margin ?? DEFAULT_MARGIN) * 56.7)

const FONT = '游明朝'
const SIZE = 21
const EM = 210

const inlineMd = useMath(new MarkdownIt({ html: false, linkify: false }))

function plain(text: string, doc: LegalDoc): string {
    let out = ''
    for (const block of inlineMd.parseInline(resolveRefs(text, doc), {})) {
        for (const t of block.children ?? []) {
            if (t.type === 'text' || t.type === 'code_inline' || t.type === 'image' || t.type === 'math_inline') out += t.content
            else if (t.type === 'hardbreak') out += '\n'
        }
    }
    return out
}

let basePt = SIZE / 2

function halfPoints(size: string | undefined): number | undefined {
    const m = size ? /^(\d+(?:\.\d+)?)(pt|px|mm|em|%)?$/.exec(size) : null
    if (!m) return undefined
    const n = Number(m[1])
    const pt = m[2] === 'px' ? n * 0.75 : m[2] === 'mm' ? n * 2.835 : m[2] === 'em' ? n * basePt : m[2] === '%' ? (n / 100) * basePt : n
    return Math.round(pt * 2)
}

const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const

function runs(text: string, opts: { bold?: boolean; props?: CdProps } = {}): TextRun[] {
    const out: TextRun[] = []
    for (const r of inlineRuns(text)) {
        const p = mergeProps(opts.props, r.props)
        r.text
            .split('\n')
            .forEach((t, i) =>
                out.push(new TextRun({ text: t, bold: opts.bold, break: i ? 1 : undefined, size: halfPoints(p?.fontSize), font: p?.fontFamily })),
            )
    }
    return out
}

function para(text: string, left: number, hanging: number, opts: { bold?: boolean; center?: boolean; props?: CdProps } = {}) {
    const p = opts.props
    return new DocxParagraph({
        alignment: p?.textAlign ? ALIGN[p.textAlign] : opts.center ? AlignmentType.CENTER : undefined,
        indent: { left: left * EM, hanging: hanging * EM },
        pageBreakBefore: p?.break || undefined,
        spacing: p?.lineHeight ? { line: Math.round(Number(p.lineHeight) * 240 * 0.8) } : undefined,
        children: runs(text, { bold: opts.bold, props: p }),
    })
}

function imagePara(src: string, alt: string, indent: number, ctx: Ctx): DocxParagraph {
    const img = ctx.images?.get(src)
    if (!img) return para(alt ? `［図：${alt}］` : '［図］', indent, 0)
    const maxPx = ((ctx.width - indent * EM) / 1440) * 96
    const scale = Math.min(1, maxPx / img.width)
    return new DocxParagraph({
        indent: { left: indent * EM },
        children: [
            new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } }),
        ],
    })
}

function figurePara(fig: { png: Uint8Array; width: number; height: number }, indent: number, ctx: Ctx, center = false): DocxParagraph {
    const maxPx = ((ctx.width - indent * EM) / 1440) * 96
    const scale = Math.min(1, maxPx / fig.width)
    return new DocxParagraph({
        alignment: center ? AlignmentType.CENTER : undefined,
        indent: { left: indent * EM },
        children: [
            new ImageRun({ type: 'png', data: fig.png, transformation: { width: Math.round(fig.width * scale), height: Math.round(fig.height * scale) } }),
        ],
    })
}

function mathPara(tex: string, indent: number, ctx: Ctx): DocxParagraph {
    const fig = ctx.figures?.get(mathKey(tex))
    return fig ? figurePara(fig, indent, ctx, true) : para(tex.trim(), indent, 0)
}

function textParas(lead: string, text: string, left: number, hanging: number, out: Block[], ctx: Ctx, opts: { props?: CdProps } = {}) {
    let buf: string[] = []
    let leadDone = false
    const flush = () => {
        if (!buf.length && (leadDone || !lead)) return
        out.push(para(`${leadDone ? '' : lead}${plain(buf.join('\n'), ctx.doc)}`, left, hanging, opts))
        leadDone = true
        buf = []
    }
    for (const line of text.split('\n')) {
        const tex = displayLine(line)
        if (tex) {
            flush()
            out.push(mathPara(tex, left, ctx))
            continue
        }
        const im = imageLine(line)
        if (!im) {
            buf.push(line)
            continue
        }
        flush()
        out.push(imagePara(im.src, im.alt, left, ctx))
    }
    flush()
}

function inherited(p: CdProps | undefined): CdProps | undefined {
    if (!p?.break) return p
    const rest = { ...p }
    delete rest.break
    return mergeProps(rest)
}

function colWidths(cols: number, width: number, props?: CdProps): number[] {
    const spec = props?.cols
    if (!spec?.length) return Array.from({ length: cols }, () => Math.floor(width / cols))
    const raw = Array.from({ length: cols }, (_, i) => {
        const c = spec[i]
        const m = c ? /^(\d+(?:\.\d+)?)(%|mm|em|pt)?$/.exec(c) : null
        if (!m) return 0
        const n = Number(m[1])
        return m[2] === 'mm' ? n * 56.7 : m[2] === 'pt' ? n * 20 : m[2] === 'em' ? n * EM : (n / 100) * width
    })
    const fixed = raw.reduce((a, b) => a + b, 0)
    const blanks = raw.filter((w) => !w).length
    const rest = blanks ? Math.max(0, width - fixed) / blanks : 0
    return raw.map((w) => Math.floor(w || rest))
}

function tableBlock(rows: string[][], indent: number, ctx: Ctx, props?: CdProps): Table {
    const cols = Math.max(...rows.map((r) => r.length))
    const grid = rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
    const spans = tableSpans(grid)
    const width = ctx.width - indent * EM
    const widths = colWidths(cols, width, props)
    const spanWidth = (c: number, n: number) => widths.slice(c - n + 1, c + 1).reduce((a, b) => a + b, 0)
    return new Table({
        columnWidths: widths,
        indent: { size: indent * EM, type: WidthType.DXA },
        width: { size: width, type: WidthType.DXA },
        rows: grid.map(
            (r, i) =>
                new TableRow({
                    tableHeader: i === 0,
                    children: r.flatMap((text, c) => {
                        const s = spans[i][c]
                        if (s.hidden) return []
                        return [
                            new TableCell({
                                borders,
                                columnSpan: s.colspan > 1 ? s.colspan : undefined,
                                rowSpan: s.rowspan > 1 ? s.rowspan : undefined,
                                verticalAlign: s.rowspan > 1 ? VerticalAlign.CENTER : undefined,
                                width: { size: spanWidth(c, s.colspan), type: WidthType.DXA },
                                shading: i === 0 ? { fill: 'F3F3F3' } : undefined,
                                children: [
                                    new DocxParagraph({
                                        alignment: props?.textAlign ? ALIGN[props.textAlign] : undefined,
                                        children: runs(text, { props: inherited(props) }),
                                    }),
                                ],
                            }),
                        ]
                    }),
                }),
        ),
    })
}

function attachBlocks(blocks: string[], indent: number, out: Block[], ctx: Ctx, blockProps?: (CdProps | undefined)[], inherit?: CdProps) {
    blocks.forEach((raw, bi) => {
        const props = mergeProps(inherit, blockProps?.[bi])
        if (props?.break) out.push(new DocxParagraph({ pageBreakBefore: true, children: [] }))
        const fence = parseFence(raw)
        if (fence?.lang === 'mermaid') {
            const fig = ctx.figures?.get(fence.body)
            out.push(fig ? figurePara(fig, indent, ctx) : para('［図］（図は PDF 版をご覧ください）', indent, 0))
            return
        }
        if (fence?.lang === 'math') {
            out.push(mathPara(fence.body, indent, ctx))
            return
        }
        const rows = parseTable(raw)
        if (rows?.length) {
            out.push(tableBlock(rows, indent, ctx, props))
            out.push(new DocxParagraph({}))
            return
        }
        for (const line of raw.split('\n')) out.push(para(line, indent, 0, { props: inherited(props) }))
    })
}

const step = (doc: LegalDoc) => (doc.config.paragraph.indent === 'nested' ? 1 : 0)

function items(list: Item[], out: Block[], ctx: Ctx, inherit?: CdProps) {
    const { doc } = ctx
    for (const it of list) {
        const props = mergeProps(inherit, it.props)
        textParas(`${it.label}　`, it.text, it.level + 1 + step(doc), 1, out, ctx, { props })
        attachBlocks(it.blocks, it.level + 1 + step(doc), out, ctx, it.blockProps, inherited(props))
        items(it.children, out, ctx, inherited(props))
    }
}

function paragraphs(list: Paragraph[], out: Block[], ctx: Ctx, head?: string, inherit?: CdProps, first?: CdProps) {
    const { doc } = ctx
    list.forEach((p, idx) => {
        const lead = idx === 0 && head ? `${head}　` : ''
        const label = p.label ? `${p.label}　` : ''
        const left = lead ? 1 : 1 + step(doc)
        const props = mergeProps(inherit, idx === 0 ? first : undefined, p.props)
        textParas(`${lead}${label}`, p.text, left, 1, out, ctx, { props })
        attachBlocks(p.blocks, 1 + step(doc), out, ctx, p.blockProps, inherited(props))
        items(p.items, out, ctx, inherited(props))
    })
}

function richBlocks(raw: string, out: Block[], ctx: Ctx, inherit?: CdProps) {
    const re = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\s*$|^(?:\|.*\|\s*\n?)+/gm
    let last = 0
    let first = inherit
    const take = () => {
        const p = first
        first = inherited(inherit)
        return p
    }
    const text = (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.trim()) out.push(para(plain(line, ctx.doc), 0, 0, { props: take() }))
    }
    for (const m of raw.matchAll(re)) {
        text(raw.slice(last, m.index))
        attachBlocks([m[0].trim()], 0, out, ctx, [take()])
        last = m.index! + m[0].length
    }
    text(raw.slice(last))
}

function partsBlocks(parts: { md: string; props?: CdProps }[], out: Block[], ctx: Ctx, inherit?: CdProps) {
    for (const part of parts) richBlocks(part.md, out, ctx, mergeProps(inherit, part.props))
}

const articleGap = () => new DocxParagraph({ spacing: { before: 0, after: 0, line: 120, lineRule: LineRuleType.EXACT }, children: [] })

function article(a: Article, out: Block[], ctx: Ctx, inherit?: CdProps) {
    const style = ctx.doc.config.article.title
    const own = mergeProps(inherit, a.props)
    const body = inherited(own)
    if (a.deleted) {
        out.push(para(`${a.label}　削除`, 1, 1, { props: own }))
        return
    }
    if (style === 'above' && a.title) {
        out.push(para(`（${resolveRefs(a.title, ctx.doc)}）`, 1, 0, { props: own }))
        if (a.paragraphs.length) paragraphs(a.paragraphs, out, ctx, a.label, body)
        else out.push(para(a.label, 1, 1, { props: body }))
    } else if (style === 'inline' && a.title) {
        out.push(para(`${a.label}（${resolveRefs(a.title, ctx.doc)}）`, 0, 0, { bold: true, props: own }))
        paragraphs(a.paragraphs, out, ctx, undefined, body)
    } else if (a.paragraphs.length === 0) {
        out.push(para(a.label, 1, 1, { props: own }))
    } else {
        paragraphs(a.paragraphs, out, ctx, a.label, body, own?.break ? { break: true } : undefined)
    }
}

function build(children: (DocxParagraph | Table)[], landscape = false, style?: DocStyle): Promise<Buffer> {
    const m = marginTwip(style)
    const section: ISectionOptions = {
        properties: {
            page: {
                size: landscape ? { width: A4_LONG, height: A4_SHORT, orientation: 'landscape' as any } : { width: A4_SHORT, height: A4_LONG },
                margin: { top: m, bottom: m, left: m, right: m },
            },
        },
        children,
    }
    const document = new Document({
        styles: {
            default: {
                document: {
                    run: { font: style?.font ?? FONT, size: style ? Math.round(style.fontSize * 2) : SIZE },
                    paragraph: { spacing: { line: Math.round((style?.lineHeight ?? 1.5) * 240 * 0.8) } },
                },
            },
        },
        sections: [section],
    })
    return Packer.toBuffer(document)
}

export function docToDocx(doc: LegalDoc, figures?: Figures, style?: DocStyle, images?: Images): Promise<Buffer> {
    const out: Block[] = []
    basePt = style?.fontSize ?? SIZE / 2
    const ctx: Ctx = { doc, figures, images, width: A4_SHORT - 2 * marginTwip(style) }
    if (doc.title) out.push(para(doc.title, 0, 0, { center: true }))
    out.push(new DocxParagraph({}))
    if (doc.preambleParts) partsBlocks(doc.preambleParts, out, ctx)
    else for (const block of doc.preamble.split(/\n[ \t]*\n/)) if (block.trim()) out.push(para(plain(block, doc), 0, 0))
    for (const ch of doc.chapters) {
        const own = ch.props
        if (ch.kind === 'closing') {
            out.push(new DocxParagraph({ pageBreakBefore: own?.break || undefined }))
            if (ch.parts) partsBlocks(ch.parts, out, ctx, inherited(own))
            else for (const line of ch.raw.trim().split(/\n/)) out.push(para(plain(line, doc), 0, 0))
            continue
        }
        if (ch.kind === 'appendix') {
            out.push(new DocxParagraph({ pageBreakBefore: own?.break || undefined }))
            out.push(para(chapterHeading(ch), 0, 0, { bold: true, props: inherited(own) }))
            if (ch.parts) partsBlocks(ch.parts, out, ctx, inherited(own))
            else richBlocks(ch.raw, out, ctx)
            continue
        }
        const heading = chapterHeading(ch)
        if (heading) out.push(para(heading, 0, 0, { center: true, props: own }))
        else if (own?.break) out.push(new DocxParagraph({ pageBreakBefore: true, children: [] }))
        paragraphs(ch.intro, out, ctx, undefined, inherited(own))
        ch.articles.forEach((a, i) => {
            if (i) out.push(articleGap())
            article(a, out, ctx, inherited(own))
        })
    }
    return build(out, false, style)
}

function cellParas(parts: Part[], fallback?: string): DocxParagraph[] {
    if (fallback) return [new DocxParagraph({ children: [new TextRun(fallback)] })]
    const lines: TextRun[][] = [[]]
    for (const p of parts) {
        p.text.split('\n').forEach((s, i) => {
            if (i > 0) lines.push([])
            if (s) lines[lines.length - 1].push(new TextRun({ text: s, underline: p.changed ? {} : undefined }))
        })
    }
    return lines.map((runs) => new DocxParagraph({ indent: { left: EM, hanging: EM }, children: runs }))
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '333333' }
const borders = { top: border, bottom: border, left: border, right: border }

function cell(children: DocxParagraph[], shade = false) {
    return new TableCell({
        borders,
        width: { size: 50, type: WidthType.PERCENTAGE },
        shading: shade ? { fill: 'F3F3F3' } : undefined,
        children,
    })
}

export function compareToDocx(rows: CompareRow[], opts: { title?: string; omitUnchanged?: boolean; style?: DocStyle } = {}): Promise<Buffer> {
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const center = (t: string) => [new DocxParagraph({ alignment: AlignmentType.CENTER, children: [new TextRun(t)] })]
    const tableRows = [
        new TableRow({ tableHeader: true, children: [cell(center('改正後'), true), cell(center('改正前'), true)] }),
        ...list.map((r) =>
            r.status === 'omitted'
                ? new TableRow({ children: [cell(center('（略）')), cell(center('（略）'))] })
                : new TableRow({
                      cantSplit: true,
                      children: [
                          cell(cellParas(r.newParts, r.status === 'removed' ? '（削る）' : undefined)),
                          cell(cellParas(r.oldParts, r.status === 'added' ? '（新設）' : undefined)),
                      ],
                  }),
        ),
    ]
    const children: (DocxParagraph | Table)[] = []
    if (opts.title) children.push(new DocxParagraph({ alignment: AlignmentType.CENTER, children: [new TextRun(opts.title)] }))
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: tableRows }))
    return build(children, true, opts.style)
}

function inlineParas(r: CompareRow): DocxParagraph[] {
    const lines: TextRun[][] = [[]]
    for (const p of r.inline) {
        p.text.split('\n').forEach((s, i) => {
            if (i > 0) lines.push([])
            if (!s) return
            const run =
                p.op === 'add'
                    ? new TextRun({ text: s, color: '1D4ED8', underline: {} })
                    : p.op === 'del'
                      ? new TextRun({ text: s, color: 'C02626', strike: true })
                      : new TextRun(s)
            lines[lines.length - 1].push(run)
        })
    }
    return lines.map(
        (children, i) =>
            new DocxParagraph({
                alignment: r.kind === 'chapter' && i === 0 ? AlignmentType.CENTER : undefined,
                indent: r.kind === 'chapter' && i === 0 ? undefined : { left: EM, hanging: EM },
                children,
            }),
    )
}

export function inlineToDocx(rows: CompareRow[], opts: { title?: string; omitUnchanged?: boolean; style?: DocStyle } = {}): Promise<Buffer> {
    const list = opts.omitUnchanged ? collapseUnchanged(rows) : rows
    const children: (DocxParagraph | Table)[] = []
    if (opts.title) children.push(new DocxParagraph({ alignment: AlignmentType.CENTER, children: [new TextRun(opts.title)] }))
    children.push(
        new DocxParagraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({ text: '削除文字', color: 'C02626', strike: true }),
                new TextRun('　'),
                new TextRun({ text: '追加文字', color: '1D4ED8', underline: {} }),
            ],
        }),
    )
    list.forEach((r, i) => {
        if (i) children.push(articleGap())
        if (r.status === 'omitted') children.push(new DocxParagraph({ alignment: AlignmentType.CENTER, children: [new TextRun('（略）')] }))
        else children.push(...inlineParas(r))
    })
    return build(children, false, opts.style)
}
