import MarkdownIt from 'markdown-it'
import { blankChain, isSectionMarker, type SignatureChain } from './mdsig-chain'
import { readConfig, type DocConfig } from './config'
import { blockLines } from './blocks'
import { onLocale, t as tr } from './i18n'
import { legalStyle, resolveStyle, type ArticleNo, type RefTarget, type DocLang, type LegalStyle, type StyleId } from './legal-styles'
import { extractProps, stripInlineProps, type CdProps } from './cd-prop'

export interface Item {
    level: number
    number: number
    branchPath?: number[]
    label: string
    text: string
    line: number
    children: Item[]
    blocks: string[]
    props?: CdProps
    blockProps?: (CdProps | undefined)[]
}

export interface Paragraph {
    number: number
    branchPath?: number[]
    label: string
    text: string
    line: number
    items: Item[]
    blocks: string[]
    props?: CdProps
    blockProps?: (CdProps | undefined)[]
}

export interface Article {
    id?: string
    title: string
    number: number
    branch: number
    deleted: boolean
    fixed?: number
    branchPath?: number[]
    label: string
    refLabel: string
    line: number
    paragraphs: Paragraph[]
    props?: CdProps
}

export type ChapterKind = 'chapter' | 'supplement' | 'appendix' | 'closing' | 'none'

export interface Chapter {
    kind: ChapterKind
    title: string
    number: number
    label: string
    line: number
    intro: Paragraph[]
    articles: Article[]
    raw: string
    props?: CdProps
    parts?: RawPart[]
}

export interface RawPart {
    md: string
    props?: CdProps
    toc?: true
}

export interface LegalDoc {
    title: string
    config: DocConfig
    warnings: string[]
    preamble: string
    preambleParts?: RawPart[]
    cover?: { line: number; end: number; parts: RawPart[] }
    toc?: { line: number }
    signatures?: SignatureChain
    chapters: Chapter[]
    refs: Record<string, Article>
    styleId: StyleId
    lang: DocLang
}

// 警告の先頭の行番号（1 始まり）。行番号がなければ 0。日本語の「3行目:」と英語の「Line 3:」のどちらも読む
export function warningLine(warning: string): number {
    const m = /^(?:(\d+)行目|Line (\d+):)/.exec(warning)
    return m ? Number(m[1] ?? m[2]) : 0
}

export const docLang = (source: string): DocLang => parseLegal(source).lang

export const docStyle = (doc: Pick<LegalDoc, 'styleId' | 'lang' | 'config'>): LegalStyle => legalStyle(doc.styleId ?? 'ja', doc.config, doc.lang ?? 'ja')

const md = new MarkdownIt({ html: true, linkify: false })
md.core.ruler.disable(['inline', 'replacements', 'smartquotes', 'text_join'], true)

const ATTR_RE = /\s*\{([^{}]*)\}\s*$/

function parseHeading(content: string): { text: string; id?: string; flags: Set<string> } {
    const flags = new Set<string>()
    let id: string | undefined
    const m = ATTR_RE.exec(content)
    let text = content
    if (m) {
        text = content.slice(0, m.index).trim()
        for (const part of m[1].split(/\s+/).filter(Boolean)) {
            if (part.startsWith('#')) id = part.slice(1)
            else flags.add(part.replace(/^\./, ''))
        }
    }
    return { text: text.trim(), id, flags }
}

const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/

function blankFrontmatter(source: string): string {
    return source.replace(FRONTMATTER_RE, (m) => m.replace(/[^\r\n]/g, ''))
}

function fixedNumber(flags: Iterable<string>): { fixed?: number; branchPath?: number[] } {
    const out: { fixed?: number; branchPath?: number[] } = {}
    for (const f of flags) {
        const n = /^n=(\d+)$/.exec(f)
        if (n) out.fixed = Number(n[1])
        const b = /^b=(\d+(?:\.\d+)*)$/.exec(f)
        if (b) out.branchPath = b[1].split('.').map(Number)
    }
    return out
}

const ITEM_ATTR_RE = /^\{((?:[nb]=[\d.]+\s*)+)\}\s*/

const parsed = new Map<string, LegalDoc>()
onLocale(() => parsed.clear())
const PARSED_MAX = 4

export function parseLegal(input: string): LegalDoc {
    const hit = parsed.get(input)
    if (hit) {
        parsed.delete(input)
        parsed.set(input, hit)
        return hit
    }
    const doc = parseUncached(input)
    parsed.set(input, doc)
    if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value!)
    return doc
}

const TOC_LINE_RE = /^\s*(?:\[\[_TOC_\]\]|\[TOC\])\s*$/
const COVER_OPEN_RE = /^\s*:{3,}\s*cover\s*:*\s*$/
const BLOCK_OPEN_RE = /^\s*:{3,}\s*\S/
const BLOCK_CLOSE_RE = /^\s*:{3,}\s*$/

interface FrontParts {
    source: string
    cover?: { line: number; end: number; md: string }
    toc?: number
    warnings: string[]
}

function takeFrontParts(source: string): FrontParts {
    if (!source.includes('cover') && !source.includes('TOC')) return { source, warnings: [] }
    const lines = source.split(/\r?\n/)
    const warnings: string[] = []
    const out: FrontParts = { source, warnings }
    let fence = ''
    let zone: 'before' | 'front' | 'body' = 'before'
    const at = (i: number, m: string) => warnings.push(tr().checks.atLine(i + 1, m))
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const f = /^\s*(`{3,}|~{3,})/.exec(line)
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''
            continue
        }
        if (f) {
            fence = f[1]
            continue
        }
        if (/^#\s/.test(line) && zone === 'before') zone = 'front'
        else if (/^##\s/.test(line)) zone = 'body'
        if (TOC_LINE_RE.test(line)) {
            if (zone !== 'front') at(i, tr().checks.tocOutside)
            else if (out.toc !== undefined) at(i, tr().checks.tocTwice)
            else {
                out.toc = i
                lines[i] = ''
            }
            continue
        }
        if (!COVER_OPEN_RE.test(line)) continue
        if (zone !== 'front') {
            at(i, tr().checks.coverOutside)
            continue
        }
        let depth = 1
        let end = -1
        for (let j = i + 1; j < lines.length && !/^##?\s/.test(lines[j]); j++) {
            if (BLOCK_CLOSE_RE.test(lines[j])) depth--
            else if (BLOCK_OPEN_RE.test(lines[j])) depth++
            if (depth === 0) {
                end = j
                break
            }
        }
        if (end < 0) {
            at(i, tr().checks.coverUnclosed)
            lines[i] = ''
            continue
        }
        if (out.cover) at(i, tr().checks.coverTwice)
        else out.cover = { line: i, end, md: lines.slice(i + 1, end).join('\n') }
        for (let j = i; j <= end; j++) lines[j] = ''
        i = end
    }
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    out.source = lines.join(eol)
    return out
}

export function richParts(source: string): RawPart[] {
    const { source: src, at } = extractProps(source)
    const lines = src.split(/\r?\n/)
    const parts: RawPart[] = []
    for (const t of md.parse(src, {})) {
        if (t.level !== 0 || !t.map || t.nesting === -1) continue
        parts.push({ md: lines.slice(t.map[0], t.map[1]).join('\n'), props: at[t.map[0]] })
    }
    return parts
}

function parseUncached(input: string): LegalDoc {
    const signed = blankChain(input)
    const front = takeFrontParts(blankFrontmatter(signed.text))
    const { source, at } = extractProps(front.source)
    const { config, warnings } = readConfig(source)
    warnings.push(...front.warnings)
    const lines = source.split(/\r?\n/)
    const tokens = md.parse(source, {})

    const refs: Record<string, Article> = Object.create(null)
    const { id: styleId, lang } = resolveStyle(config, source)
    const doc: LegalDoc = { title: '', config, warnings, preamble: '', chapters: [], refs, styleId, lang }
    if (signed.chain) doc.signatures = signed.chain
    const preambleRanges: [number, number][] = []
    const propsAt = (line: number) => (line >= 0 ? at[line] : undefined)

    let chapter: Chapter | null = null
    let article: Article | null = null
    let listDepth = 0
    const stack: (Paragraph | Item)[] = []
    let currentNode: Paragraph | Item | null = null
    let seenTitle = false

    const newChapter = (kind: ChapterKind, title: string, line: number): Chapter => {
        const ch: Chapter = { kind, title, number: 0, label: '', line, intro: [], articles: [], raw: '', props: propsAt(line) }
        doc.chapters.push(ch)
        return ch
    }

    const lastParagraph = (): Paragraph | Item | null => {
        const list = article ? article.paragraphs : chapter ? chapter.intro : null
        if (!list) return null
        const p = list.at(-1)
        if (!p) return newParagraph(-1)
        let node: Paragraph | Item = p
        while (true) {
            const kids: Item[] = 'items' in node ? node.items : node.children
            const last = kids.at(-1)
            if (!last) break
            node = last
        }
        return node
    }

    const newParagraph = (line: number): Paragraph | null => {
        const p: Paragraph = { number: 0, label: '', text: '', line, items: [], blocks: [], props: propsAt(line) }
        if (article) article.paragraphs.push(p)
        else if (chapter && chapter.kind !== 'closing') chapter.intro.push(p)
        else return null
        return p
    }

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]
        const line = t.map ? t.map[0] : -1

        if (t.level === 0 && t.map && t.nesting !== -1 && t.type !== 'heading_open') {
            if (t.type === 'html_block' && (/<!--\s*clausedown/.test(t.content) || isSectionMarker(t.content))) continue
            if (!chapter && seenTitle) preambleRanges.push([t.map[0], t.map[1]])
            if (chapter?.kind === 'closing' || chapter?.kind === 'appendix') {
                const part = lines.slice(t.map[0], t.map[1]).join('\n')
                chapter.raw += part + '\n\n'
                ;(chapter.parts ??= []).push({ md: part, props: propsAt(t.map[0]) })
            }
        }

        if (t.type === 'heading_open') {
            const inline = tokens[i + 1]
            const h = parseHeading(inline.content)
            i += 2
            if (t.tag === 'h1') {
                if (!seenTitle) {
                    doc.title = h.text
                    seenTitle = true
                }
                continue
            }
            if (t.tag === 'h2') {
                const kind: ChapterKind = h.flags.has('supplement')
                    ? 'supplement'
                    : h.flags.has('appendix')
                      ? 'appendix'
                      : h.flags.has('closing')
                        ? 'closing'
                        : 'chapter'
                chapter = newChapter(kind, h.text, line)
                article = null
                continue
            }
            if (t.tag === 'h3') {
                if (!chapter || chapter.kind === 'closing' || chapter.kind === 'appendix') chapter = newChapter('none', '', line)
                article = {
                    id: h.id,
                    title: h.text,
                    number: 0,
                    branch: h.flags.has('branch') ? 1 : 0,
                    deleted: h.flags.has('deleted'),
                    ...fixedNumber(h.flags),
                    label: '',
                    refLabel: '',
                    line,
                    paragraphs: [],
                    props: propsAt(line),
                }
                chapter.articles.push(article)
                continue
            }
            warnings.push(tr().checks.atLine(line + 1, tr().checks.headingTooDeep))
            continue
        }

        if (chapter?.kind === 'closing' || chapter?.kind === 'appendix') continue

        if (t.type === 'table_open' || t.type === 'fence') {
            if (t.map) {
                const target = listDepth > 0 ? stack[listDepth] : lastParagraph()
                if (target) {
                    target.blocks.push(dedent(lines.slice(t.map[0], t.map[1])))
                    const bp = propsAt(t.map[0])
                    if (bp) (target.blockProps ??= [])[target.blocks.length - 1] = bp
                }
            }
            if (t.type === 'table_open') while (i < tokens.length && tokens[i].type !== 'table_close') i++
            continue
        }

        switch (t.type) {
            case 'bullet_list_open':
            case 'ordered_list_open':
                listDepth++
                break
            case 'bullet_list_close':
            case 'ordered_list_close':
                listDepth--
                break
            case 'list_item_open': {
                if (listDepth === 1) {
                    currentNode = newParagraph(line)
                } else {
                    const parent = stack[listDepth - 1]
                    if (!parent) {
                        currentNode = null
                        break
                    }
                    const item: Item = { level: listDepth - 1, number: 0, label: '', text: '', line, children: [], blocks: [], props: propsAt(line) }
                    if ('items' in parent) parent.items.push(item)
                    else parent.children.push(item)
                    currentNode = item
                }
                if (currentNode) stack[listDepth] = currentNode
                stack.length = listDepth + 1
                break
            }
            case 'list_item_close':
                currentNode = listDepth > 0 ? (stack[listDepth - 1] ?? null) : null
                break
            case 'inline': {
                if (listDepth === 0) {
                    const p = newParagraph(line)
                    if (p) p.text = t.content
                    break
                }
                const node = stack[listDepth]
                if (node) node.text = node.text ? `${node.text}\n${t.content}` : t.content
                break
            }
        }
    }

    doc.preamble = preambleRanges.map(([a, b]) => lines.slice(a, b).join('\n')).join('\n\n')
    if (preambleRanges.some(([a]) => at[a]) || front.toc !== undefined)
        doc.preambleParts = preambleRanges.map(([a, b]) => ({ md: lines.slice(a, b).join('\n'), props: at[a] }))
    if (front.toc !== undefined) {
        doc.toc = { line: front.toc }
        const before = preambleRanges.filter(([a]) => a < front.toc!).length
        doc.preambleParts!.splice(before, 0, { md: '', toc: true })
    }
    if (front.cover) doc.cover = { line: front.cover.line, end: front.cover.end, parts: richParts(front.cover.md) }
    number(doc)
    return doc
}

function numberItems(items: Item[], config: DocConfig, style: LegalStyle) {
    let n = 0
    for (const item of items) {
        const m = ITEM_ATTR_RE.exec(item.text)
        const fixed = m ? fixedNumber(m[1].trim().split(/\s+/)) : {}
        if (m) item.text = item.text.slice(m[0].length)
        n = fixed.fixed ?? (fixed.branchPath ? n : n + 1)
        item.number = n
        item.branchPath = fixed.branchPath
        item.label = style.itemLabel(item.number, item.branchPath, item.level, config)
        numberItems(item.children, config, style)
    }
}

function numberParagraphs(paras: Paragraph[], config: DocConfig, style: LegalStyle, forceNumbered: boolean, owner: ArticleNo | null, chapterNo: number) {
    let n = 0
    paras.forEach((p, idx) => {
        const m = ITEM_ATTR_RE.exec(p.text)
        const fixed = m ? fixedNumber(m[1].trim().split(/\s+/)) : {}
        if (m) p.text = p.text.slice(m[0].length)
        n = fixed.fixed ?? (fixed.branchPath ? n : n + 1)
        p.number = n
        p.branchPath = fixed.branchPath
        const numbered = style.paragraphNumbered(idx, paras.length, forceNumbered || !!m, config)
        p.label = numbered ? style.paragraphLabel(n, p.branchPath, owner, chapterNo, config) : ''
        numberItems(p.items, config, style)
    })
}

export function articleLabel(n: number, branch: number, config: DocConfig, path?: number[]): string {
    return legalStyle('ja', config).articleLabel({ number: n, branch, branchPath: path }, 0, config)
}

function number(doc: LegalDoc) {
    const { config } = doc
    const style = docStyle(doc)
    const perChapter = style.perChapter || config.article.numbering === 'perChapter'
    let chapterNo = 0
    let articleNo = 0
    for (const ch of doc.chapters) {
        if (ch.kind === 'chapter') {
            chapterNo++
            ch.number = chapterNo
            ch.label = style.chapterLabel(chapterNo, config)
            if (perChapter) articleNo = 0
        }
        const reset = ch.kind === 'supplement' && style.resetInSupplement
        const owner = ch.kind === 'chapter' ? ch.number : 0
        let n = reset ? 0 : articleNo
        let prev: Article | null = null
        for (const a of ch.articles) {
            if (a.branchPath) {
                n = a.fixed ?? n
                a.number = n
                a.branch = a.branchPath[0] - 1
            } else if (a.branch > 0 && prev) {
                a.number = prev.number
                a.branch = prev.branch + 1
            } else {
                a.branch = 0
                n = a.fixed ?? n + 1
                a.number = n
            }
            a.label = style.articleLabel(a, owner, config)
            a.refLabel = style.articleRef(a, owner, config, ch.kind === 'supplement')
            numberParagraphs(a.paragraphs, config, style, false, a, owner)
            if (a.id) {
                if (doc.refs[a.id]) doc.warnings.push(tr().checks.duplicateId(a.id))
                doc.refs[a.id] = a
            }
            prev = a
        }
        if (!reset) articleNo = n
        numberParagraphs(ch.intro, config, style, ch.kind === 'supplement' && ch.intro.length > 1, null, owner)
    }
}

export const REF_RE = /\[\[([^\]:]+)((?::\d+)*)\]\]/g

function findItem(list: Item[], n: number): Item | undefined {
    return list.find((it) => it.number === n && !it.branchPath)
}

export function refText(a: Article, path: number[], doc: LegalDoc): string {
    const style = docStyle(doc)
    const [para, ...items] = path
    const t: RefTarget = { article: a, articleRef: a.refLabel, items: [] }
    let kids: Item[] = []
    if (para !== undefined) {
        const index = a.paragraphs.findIndex((p) => p.number === para && !p.branchPath)
        const p = index >= 0 ? a.paragraphs[index] : undefined
        const label = p
            ? p.label || (a.paragraphs.length > 1 ? style.paragraphLabel(para, undefined, a, 0, doc.config) : '')
            : style.paragraphLabel(para, undefined, a, 0, doc.config)
        t.paragraph = { number: para, label, index: index >= 0 ? index : para - 1, count: a.paragraphs.length }
        kids = p?.items ?? []
    }
    items.forEach((n, i) => {
        const found = findItem(kids, n)
        t.items.push({ number: n, level: i + 1, label: found?.label ?? style.itemLabel(n, undefined, i + 1, doc.config) })
        kids = found?.children ?? []
    })
    return style.ref(t, doc.config)
}

export function resolveRefs(text: string, doc: LegalDoc, onMissing?: (id: string) => string): string {
    return text.replace(REF_RE, (whole, id: string, rest: string) => {
        const a = doc.refs[id.trim()]
        if (!a) return onMissing ? onMissing(id) : whole
        return refText(a, rest ? rest.slice(1).split(':').map(Number) : [], doc)
    })
}

function dedent(ls: string[]): string {
    const indents = ls.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length)
    const n = indents.length ? Math.min(...indents) : 0
    return ls
        .map((l) => l.slice(n))
        .join('\n')
        .trimEnd()
}

export function chapterHeading(ch: Chapter, doc?: LegalDoc): string {
    const style = doc ? docStyle(doc) : null
    if (ch.kind === 'supplement') return ch.title || (style?.supplementName ?? '附則')
    if (ch.kind === 'appendix') return ch.title || (style?.appendixName ?? '別表')
    return [ch.label, ch.title].filter(Boolean).join(style?.sep ?? '　')
}

export const articleTitle = (a: Article, doc: LegalDoc): string => (a.title ? stripInlineProps(resolveRefs(a.title, doc)) : '')

export function articleLines(a: Article, doc: LegalDoc): string[] {
    if (doc.styleId && doc.styleId !== 'ja') return latinArticleLines(a, doc)
    const { config } = doc
    const out: string[] = []
    const step = config.paragraph.indent === 'nested' ? 1 : 0
    const pad = (n: number) => '　'.repeat(n)
    const r = (s: string) => stripInlineProps(resolveRefs(s, doc)).replace(/\n/g, '')
    if (config.article.title === 'above' && a.title && !a.deleted) out.push(`（${articleTitle(a, doc)}）`)
    const head = config.article.title === 'inline' && a.title && !a.deleted ? `${a.label}（${articleTitle(a, doc)}）` : a.label
    if (a.deleted) {
        out.push(`${head}　削除`)
        return out
    }
    const pushBlocks = (blocks: string[], level: number) => {
        for (const b of blocks) for (const l of blockLines(b)) out.push(`${pad(level + step)}${l}`)
    }
    const pushItems = (items: Item[]) => {
        for (const it of items) {
            out.push(`${pad(it.level + step)}${it.label}　${r(it.text)}`)
            pushBlocks(it.blocks, it.level + 1)
            pushItems(it.children)
        }
    }
    if (a.paragraphs.length === 0) out.push(head)
    a.paragraphs.forEach((p, idx) => {
        if (idx === 0) {
            if (config.article.title === 'inline' && a.title) {
                out.push(head)
                out.push(p.label ? `${pad(step)}${p.label}　${r(p.text)}` : `${pad(step)}${r(p.text)}`)
            } else {
                out.push(`${head}　${p.label ? p.label + '　' : ''}${r(p.text)}`)
            }
        } else {
            out.push(`${pad(step)}${p.label}　${r(p.text)}`)
        }
        pushBlocks(p.blocks, 1)
        pushItems(p.items)
    })
    return out
}

export const shownTitle = (a: Article, doc: LegalDoc): string => (doc.config.article.title === 'none' || a.deleted ? '' : articleTitle(a, doc))

const LATIN_PAD = '    '

function latinArticleLines(a: Article, doc: LegalDoc): string[] {
    const style = docStyle(doc)
    const out: string[] = []
    const r = (s: string) => stripInlineProps(resolveRefs(s, doc)).replace(/\n/g, ' ')
    const pad = (n: number) => LATIN_PAD.repeat(n)
    if (a.deleted) return [style.deletedLine(a.label)]
    const head = style.head(a.label, shownTitle(a, doc), !!a.paragraphs[0]?.label)
    out.push(...head.lines)
    const withNum = (label: string, text: string) => (label ? `${label} ${text}` : text)
    const pushBlocks = (blocks: string[], level: number) => {
        for (const b of blocks) for (const l of blockLines(b)) out.push(`${pad(level)}${l}`)
    }
    const pushItems = (items: Item[], base: number) => {
        for (const it of items) {
            out.push(`${pad(base + it.level)}${withNum(it.label, r(it.text))}`)
            pushBlocks(it.blocks, base + it.level + 1)
            pushItems(it.children, base)
        }
    }
    if (a.paragraphs.length === 0 && head.runIn) out.push(head.runIn)
    a.paragraphs.forEach((p, idx) => {
        const line = withNum(p.label, r(p.text))
        out.push(idx === 0 && head.runIn ? `${head.runIn} ${line}` : line)
        pushBlocks(p.blocks, 1)
        pushItems(p.items, 0)
    })
    return out
}

export function introLines(ch: Chapter, doc: LegalDoc): string[] {
    const out: string[] = []
    const latin = !!doc.styleId && doc.styleId !== 'ja'
    const sp = latin ? ' ' : '　'
    const indent = (n: number) => (latin ? LATIN_PAD : '　').repeat(n)
    const r = (s: string) => stripInlineProps(resolveRefs(s, doc)).replace(/\n/g, latin ? ' ' : '')
    const pushBlocks = (blocks: string[], level: number) => {
        for (const b of blocks) for (const l of blockLines(b)) out.push(`${indent(level)}${l}`)
    }
    const pushItems = (items: Item[]) => {
        for (const it of items) {
            out.push(`${indent(it.level)}${it.label}${sp}${r(it.text)}`)
            pushBlocks(it.blocks, it.level + 1)
            pushItems(it.children)
        }
    }
    for (const p of ch.intro) {
        if (p.text || p.label) out.push(p.label ? `${p.label}${sp}${r(p.text)}` : r(p.text))
        pushBlocks(p.blocks, 1)
        pushItems(p.items)
    }
    return out
}
