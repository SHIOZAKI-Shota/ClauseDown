import MarkdownIt from 'markdown-it'
import { readConfig, type DocConfig } from './config'
import { formatNumber, type NumeralStyle } from './numerals'
import { blockLines } from './blocks'
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
}

export interface LegalDoc {
    title: string
    config: DocConfig
    warnings: string[]
    preamble: string
    preambleParts?: RawPart[]
    chapters: Chapter[]
    refs: Record<string, Article>
}

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

const branchSuffix = (path: number[] | undefined, style: NumeralStyle) =>
    (path ?? []).map((b) => `の${formatNumber(b, style)}`).join('')

const parsed = new Map<string, LegalDoc>()
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

function parseUncached(input: string): LegalDoc {
    const { source, at } = extractProps(blankFrontmatter(input))
    const { config, warnings } = readConfig(source)
    const lines = source.split(/\r?\n/)
    const tokens = md.parse(source, {})

    const refs: Record<string, Article> = Object.create(null)
    const doc: LegalDoc = { title: '', config, warnings, preamble: '', chapters: [], refs }
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
            if (t.type === 'html_block' && /<!--\s*clausedown/.test(t.content)) continue
            if (!chapter && seenTitle) preambleRanges.push([t.map[0], t.map[1]])
            if (chapter?.kind === 'closing' || chapter?.kind === 'appendix') {
                const part = lines.slice(t.map[0], t.map[1]).join('\n')
                chapter.raw += part + '\n\n'
                    ; (chapter.parts ??= []).push({ md: part, props: propsAt(t.map[0]) })
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
            warnings.push(`${line + 1}行目: 見出しは ### （条）までしか使えません`)
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
    if (preambleRanges.some(([a]) => at[a])) doc.preambleParts = preambleRanges.map(([a, b]) => ({ md: lines.slice(a, b).join('\n'), props: at[a] }))
    number(doc)
    return doc
}

function subitemStyles(config: DocConfig): NumeralStyle[] {
    const order: NumeralStyle[] = ['iroha', 'paren', 'roman']
    const first = config.subitem.style as NumeralStyle
    return [first, ...order.filter((s) => s !== first)]
}

function numberItems(items: Item[], config: DocConfig, styles: NumeralStyle[]) {
    let n = 0
    for (const item of items) {
        const m = ITEM_ATTR_RE.exec(item.text)
        const fixed = m ? fixedNumber(m[1].trim().split(/\s+/)) : {}
        if (m) item.text = item.text.slice(m[0].length)
        n = fixed.fixed ?? (fixed.branchPath ? n : n + 1)
        item.number = n
        item.branchPath = fixed.branchPath
        const style: NumeralStyle =
            item.level === 1
                ? (config.item.style as NumeralStyle)
                : styles[Math.min(item.level - 2, styles.length - 1)]
        item.label = formatNumber(item.number, style) + branchSuffix(item.branchPath, style === 'kanji' ? 'kanji' : 'arabic')
        numberItems(item.children, config, styles)
    }
}

function numberParagraphs(paras: Paragraph[], config: DocConfig, forceNumbered: boolean) {
    const styles = subitemStyles(config)
    const style = config.paragraph.numeral as NumeralStyle
    let n = 0
    paras.forEach((p, idx) => {
        const m = ITEM_ATTR_RE.exec(p.text)
        const fixed = m ? fixedNumber(m[1].trim().split(/\s+/)) : {}
        if (m) p.text = p.text.slice(m[0].length)
        n = fixed.fixed ?? (fixed.branchPath ? n : n + 1)
        p.number = n
        p.branchPath = fixed.branchPath
        const numbered = idx > 0 || config.paragraph.firstNumbered || forceNumbered || !!m
        p.label = numbered ? formatNumber(n, style) + branchSuffix(p.branchPath, style === 'circled' ? 'arabic' : style) : ''
        numberItems(p.items, config, styles)
    })
}

export function articleLabel(n: number, branch: number, config: DocConfig, path?: number[]): string {
    const style = config.article.numeral as NumeralStyle
    const base = `第${formatNumber(n, style)}条`
    if (path?.length) return base + branchSuffix(path, style)
    return branch > 0 ? `${base}の${formatNumber(branch + 1, style)}` : base
}

function number(doc: LegalDoc) {
    const { config } = doc
    let chapterNo = 0
    let articleNo = 0
    for (const ch of doc.chapters) {
        if (ch.kind === 'chapter') {
            chapterNo++
            ch.number = chapterNo
            ch.label =
                config.chapter.numeral === 'none'
                    ? ''
                    : `第${formatNumber(chapterNo, config.chapter.numeral as NumeralStyle)}章`
            if (config.article.numbering === 'perChapter') articleNo = 0
        }
        let n = ch.kind === 'supplement' ? 0 : articleNo
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
            a.label = articleLabel(a.number, a.branch, config, a.branchPath)
            a.refLabel = ch.kind === 'supplement' ? `附則${a.label}` : a.label
            numberParagraphs(a.paragraphs, config, false)
            if (a.id) {
                if (doc.refs[a.id]) doc.warnings.push(`条の名前「${a.id}」が重複しています`)
                doc.refs[a.id] = a
            }
            prev = a
        }
        if (ch.kind !== 'supplement') articleNo = n
        numberParagraphs(ch.intro, config, ch.kind === 'supplement' && ch.intro.length > 1)
    }
}

const REF_RE = /\[\[([^\]:]+)(?::(\d+))?(?::(\d+))?\]\]/g

export function resolveRefs(text: string, doc: LegalDoc, onMissing?: (id: string) => string): string {
    const style = doc.config.article.numeral as NumeralStyle
    return text.replace(REF_RE, (whole, id: string, para?: string, item?: string) => {
        const a = doc.refs[id.trim()]
        if (!a) return onMissing ? onMissing(id) : whole
        let out = a.refLabel
        if (para) out += `第${formatNumber(Number(para), style)}項`
        if (item) out += `第${formatNumber(Number(item), style)}号`
        return out
    })
}

function dedent(ls: string[]): string {
    const indents = ls.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length)
    const n = indents.length ? Math.min(...indents) : 0
    return ls.map((l) => l.slice(n)).join('\n').trimEnd()
}

export function chapterHeading(ch: Chapter): string {
    if (ch.kind === 'supplement') return ch.title || '附則'
    if (ch.kind === 'appendix') return ch.title || '別表'
    return [ch.label, ch.title].filter(Boolean).join('　')
}

export function articleLines(a: Article, doc: LegalDoc): string[] {
    const { config } = doc
    const out: string[] = []
    const step = config.paragraph.indent === 'nested' ? 1 : 0
    const pad = (n: number) => '　'.repeat(n)
    const r = (s: string) => stripInlineProps(resolveRefs(s, doc)).replace(/\n/g, '')
    if (config.article.title === 'above' && a.title && !a.deleted) out.push(`（${a.title}）`)
    const head =
        config.article.title === 'inline' && a.title && !a.deleted ? `${a.label}（${a.title}）` : a.label
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

export function introLines(ch: Chapter, doc: LegalDoc): string[] {
    const out: string[] = []
    const r = (s: string) => stripInlineProps(resolveRefs(s, doc)).replace(/\n/g, '')
    const pushBlocks = (blocks: string[], level: number) => {
        for (const b of blocks) for (const l of blockLines(b)) out.push(`${'　'.repeat(level)}${l}`)
    }
    const pushItems = (items: Item[]) => {
        for (const it of items) {
            out.push(`${'　'.repeat(it.level)}${it.label}　${r(it.text)}`)
            pushBlocks(it.blocks, it.level + 1)
            pushItems(it.children)
        }
    }
    for (const p of ch.intro) {
        if (p.text || p.label) out.push(p.label ? `${p.label}　${r(p.text)}` : r(p.text))
        pushBlocks(p.blocks, 1)
        pushItems(p.items)
    }
    return out
}
