import { articleLabel, parseLegal, resolveRefs, type Article, type Item, type LegalDoc, type Paragraph } from './legal-parser'
import { toFullwidth, toKanji } from './numerals'
import { stripInlineProps } from './cd-prop'

export interface HouritsuConversion {
    converted: number
    skipped: string[]
    warnings: { path: string; messages: string[] }[]
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const CONFIG_MARK_RE = /<!--\s*clausedown/

export function splitFrontmatter(text: string): { fm: string; body: string } {
    const m = FM_RE.exec(text)
    return m ? { fm: m[0].replace(/\r?\n$/, ''), body: text.slice(m[0].length) } : { fm: '', body: text }
}

export function isHouritsu(text: string): boolean {
    const m = FM_RE.exec(text.replace(/^﻿/, ''))
    return !!m && /^law_id:/m.test(m[1]) && /^law_num:/m.test(m[1]) && !CONFIG_MARK_RE.test(text)
}

const NUM = '[〇一二三四五六七八九十百千]+'

export function fromKanji(s: string): number {
    let total = 0
    let cur = 0
    for (const c of s) {
        const v = '〇一二三四五六七八九'.indexOf(c)
        if (v >= 0) cur = cur * 10 + v
        else {
            total += (cur || 1) * (c === '千' ? 1000 : c === '百' ? 100 : 10)
            cur = 0
        }
    }
    return total + cur
}

interface NumberId {
    base: number
    path: number[]
}

const parseId = (base: string, branches: string): NumberId => ({
    base: fromKanji(base),
    path: branches.split('の').filter(Boolean).map(fromKanji),
})
const idLabel = (a: NumberId) => `第${toKanji(a.base)}条${a.path.map((b) => `の${toKanji(b)}`).join('')}`

const ARTICLE_RE = new RegExp(
    `^第(${NUM})条((?:の${NUM})*)(?:(から|及び)第(${NUM})条((?:の${NUM})*)(?:まで)?)?[\\s　]*(?:（(.*)）)?[\\s　]*$`,
)
const ITEM_NO_RE = new RegExp(`^(${NUM})((?:の${NUM})*)$`)
const LABEL_RE = new RegExp(`^(?:${NUM}(?:の${NUM})*|[ァ-ヶ](?:の${NUM})*|[（(][^（）()]{1,6}[）)]|[①-⑳])$`)
const CHAPTER_RE = new RegExp(`^第${NUM}(?:の${NUM})*章`)
const DIVISION_RE = new RegExp(`^第${NUM}(?:の${NUM})*[編節款目]`)
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/
const SUPPLEMENT_RE = /^附\s*則/
const APPENDIX_RE = /^(別表|別記|別図|様式|別紙)/
const LIST_RE = /^(\s*)[-*][ 　]+(.*)$/
const LABELED_RE = /^(\S+)[ 　]+(.*)$/
const PARA_NO_RE = /^([０-９]+)[ 　]+(.*)$/
const CAPTION_RE = /^（(?!図|表)[^（）]*）$/
const FIGURE_RE = /^(?:!?\[[^\]]*\]\([^)]*\)|（図[：:][^）]*）)$/
const TABLE_START_RE = /^\s*<table\b/i
const TABLE_END_RE = /<\/table>/i

function expandRange(from: NumberId, to: NumberId): NumberId[] {
    const out: NumberId[] = []
    if (from.base === to.base) {
        for (let b = from.path[0] ?? 1; b <= (to.path[0] ?? 1); b++) out.push({ base: from.base, path: b === 1 ? [] : [b] })
        return out
    }
    out.push(from)
    for (let n = from.base + 1; n <= to.base; n++) out.push({ base: n, path: [] })
    for (let b = 2; b <= (to.path[0] ?? 1); b++) out.push({ base: to.base, path: [b] })
    return out
}

const CONFIG = `<!-- clausedown
chapter: { numeral: none }
article: { numeral: kanji, title: above }
paragraph: { firstNumbered: false, numeral: fullwidth, indent: flush }
item: { style: kanji }
subitem: { style: iroha }
-->`

const parseFw = (s: string) => Number(s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10)))

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"' }

function htmlTable(html: string): string[] {
    const grid: string[][] = []
    const strip = (s: string) =>
        s
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&(?:nbsp|lt|gt|amp|quot);/g, (e) => ENTITIES[e])
            .replace(/\|/g, '｜')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^>$/, '＞')
            .replace(/^\^$/, '＾')
    let r = 0
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        grid[r] ??= []
        let c = 0
        for (const cell of row[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
            while (grid[r][c] !== undefined) c++
            const rs = Math.max(1, Number(/rowspan="?(\d+)/i.exec(cell[2])?.[1] ?? 1))
            const cs = Math.max(1, Number(/colspan="?(\d+)/i.exec(cell[2])?.[1] ?? 1))
            const text = strip(cell[3])
            for (let i = 0; i < rs; i++)
                for (let j = 0; j < cs; j++) (grid[r + i] ??= [])[c + j] = i > 0 ? '^' : j < cs - 1 ? '>' : text
            c += cs
        }
        r++
    }
    if (!grid.length) return []
    const width = Math.max(1, ...grid.map((row) => row.length))
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`
    return [line(grid[0]), `|${' --- |'.repeat(width)}`, ...grid.slice(1).map(line)]
}

export function fromHouritsu(text: string): { text: string; warnings: string[] } {
    const nl = text.includes('\r\n') ? '\r\n' : '\n'
    const { fm, body } = splitFrontmatter(text.replace(/^﻿/, ''))
    const lines = body.split(/\r?\n/)
    const out: string[] = []
    const warnings: string[] = []
    const expected: string[][] = [[]]
    let section = expected[0]
    let mode = 'top' as 'top' | 'body' | 'appendix'
    let titled = false
    let para = 0
    let item = 0
    let unnumbered = 0
    let last = 0
    let lastBranch = 0
    let chapterStart = true
    let caption = ''

    const nextNonBlank = (i: number) => {
        for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return k
        return -1
    }
    const startParagraph = (s: string) => {
        para++
        item = 0
        out.push(caption ? `- ${caption}\n  ${s}` : `- ${s}`)
        caption = ''
    }
    const startSection = (m: typeof mode) => {
        mode = m
        para = 0
        caption = ''
    }

    // 自動付番と違うときだけ{n=… b=…}
    const attrs = (id: NumberId, deleted: boolean) => {
        const f: string[] = []
        if (id.path.length) {
            const next = id.path.length === 1 && !chapterStart && id.base === last && id.path[0] === Math.max(lastBranch, 1) + 1
            f.push(next ? '.branch' : `n=${id.base} b=${id.path.join('.')}`)
            lastBranch = id.path[0]
        } else {
            if (id.base !== last + 1) f.push(`n=${id.base}`)
            lastBranch = 0
        }
        last = id.base
        chapterStart = false
        if (deleted) f.push('.deleted')
        return f.length ? `{${f.join(' ')}}` : ''
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        const h = HEADING_RE.exec(raw)
        if (h) {
            const t = h[2]
            if (h[1] === '#' && !titled) {
                titled = true
                out.push(raw, '', CONFIG)
                continue
            }
            if (SUPPLEMENT_RE.test(t)) {
                startSection('body')
                last = 0
                chapterStart = true
                expected.push((section = []))
                out.push(`## ${t} {.supplement}`)
                continue
            }
            if (APPENDIX_RE.test(t)) {
                startSection('appendix')
                out.push(`## ${t} {.appendix}`)
                continue
            }
            if (CHAPTER_RE.test(t)) {
                startSection('body')
                chapterStart = true
                out.push(`## ${t}`)
                continue
            }
            if (DIVISION_RE.test(t)) {
                out.push('')
                continue
            }
            const a = mode === 'appendix' ? null : ARTICLE_RE.exec(t)
            if (a) {
                startSection('body')
                const from = parseId(a[1], a[2])
                const to = a[4] ? parseId(a[4], a[5]) : null
                const k = nextNonBlank(i)
                const after = k >= 0 ? nextNonBlank(k) : -1
                const deleted = k >= 0 && lines[k].trim() === '削除' && (after < 0 || HEADING_RE.test(lines[after]))
                if (deleted) {
                    const ids = !to ? [from] : a[3] === '及び' ? [from, to] : expandRange(from, to)
                    for (const id of ids) {
                        section.push(idLabel(id))
                        out.push(`### ${attrs(id, true)}`, '')
                    }
                    out.pop()
                    i = k
                    continue
                }
                if (to) warnings.push(`「${t}」は範囲の見出しですが、削除ではありません`)
                section.push(idLabel(from))
                out.push(['###', a[6], attrs(from, false)].filter(Boolean).join(' '))
                continue
            }
            warnings.push(`見出し「${t}」は、本文の一行として取り込みました`)
            out.push(t)
            continue
        }

        if (TABLE_START_RE.test(raw)) {
            const html = [raw]
            while (!TABLE_END_RE.test(html[html.length - 1]) && i + 1 < lines.length) html.push(lines[++i])
            out.push(...htmlTable(html.join('\n')))
            continue
        }

        if (mode !== 'body' || !raw.trim()) {
            out.push(raw)
            continue
        }

        const trimmed = raw.trim()
        if (FIGURE_RE.test(trimmed) && para > 0) {
            out.push(`  ${trimmed}`)
            continue
        }

        const list = LIST_RE.exec(raw)
        if (list) {
            const depth = Math.floor(list[1].length / 2) + 1
            const labeled = LABELED_RE.exec(list[2])
            const label = labeled && LABEL_RE.test(labeled[1]) ? labeled : null
            let mark = ''
            const no = label && depth === 1 ? ITEM_NO_RE.exec(label[1]) : null
            if (no) {
                const id = parseId(no[1], no[2])
                if (id.path.length) mark = id.base === item ? `{b=${id.path.join('.')}} ` : `{n=${id.base} b=${id.path.join('.')}} `
                else if (id.base !== item + 1) mark = `{n=${id.base}} `
                item = id.base
            } else if (depth === 1) item++
            if (para === 0) startParagraph('')
            out.push(`${'  '.repeat(depth)}- ${mark}${label ? label[2] : list[2]}`)
            continue
        }

        if (CAPTION_RE.test(trimmed)) {
            const k = nextNonBlank(i)
            if (k >= 0 && !HEADING_RE.test(lines[k]) && !LIST_RE.test(lines[k])) {
                caption = trimmed
                continue
            }
        }

        const p = PARA_NO_RE.exec(raw)
        if (p && parseFw(p[1]) === para + 1) {
            startParagraph(p[2])
            continue
        }
        if (/^\s/.test(raw) || /^[|!<]/.test(raw)) {
            out.push(raw)
            continue
        }
        if (para > 0) unnumbered++
        startParagraph(raw)
    }

    if (unnumbered) warnings.push(`項の番号が書かれていない古い条文の ${unnumbered} 項に、番号を付けました`)
    let result = out.join('\n').replace(/\n{3,}/g, '\n\n')
    if (!titled) result = `${CONFIG}\n\n${result}`
    result = (fm ? `${fm}\n\n` : '') + result.replace(/^\n+/, '')

    const wrong = checkNumbers(result, expected)
    if (wrong.length) warnings.push(`条の番号が元と合いません：${wrong.slice(0, 5).join('、')}${wrong.length > 5 ? ` ほか ${wrong.length - 5} 件` : ''}`)

    return { text: nl === '\n' ? result : result.replace(/\n/g, nl), warnings }
}

function checkNumbers(result: string, expected: string[][]): string[] {
    const doc = parseLegal(result)
    const labels: string[][] = [[]]
    for (const c of doc.chapters) {
        if (c.kind === 'supplement') labels.push(c.articles.map((a) => a.label))
        else if (c.kind === 'chapter' || c.kind === 'none') labels[0].push(...c.articles.map((a) => a.label))
    }
    const wrong: string[] = []
    expected.forEach((sec, si) =>
        sec.forEach((l, ai) => {
            const got = labels[si]?.[ai]
            if (got !== l) wrong.push(`${l}（${got ?? 'なし'}）`)
        }),
    )
    return wrong
}

function itemLines(items: Item[], doc: LegalDoc, out: string[]) {
    for (const it of items) {
        const label = it.label.replace(/\d/g, (d) => toFullwidth(d))
        out.push(`${'  '.repeat(it.level - 1)}- ${label} ${stripInlineProps(resolveRefs(it.text, doc))}`, '')
        for (const b of it.blocks) out.push(b, '')
        itemLines(it.children, doc, out)
    }
}

function paragraphLines(ps: Paragraph[], doc: LegalDoc, out: string[], numberFirst: boolean) {
    ps.forEach((p, i) => {
        let text = stripInlineProps(resolveRefs(p.text, doc))
        const cap = /^（[^（）]*）\n/.exec(text)
        if (cap) {
            out.push(cap[0].trim(), '')
            text = text.slice(cap[0].length)
        }
        const numbered = i > 0 || numberFirst
        if (text || numbered) out.push(numbered ? `${toFullwidth(i + 1)} ${text}` : text, '')
        for (const b of p.blocks) out.push(b, '')
        itemLines(p.items, doc, out)
    })
}

export function toHouritsu(source: string): string {
    const { fm } = splitFrontmatter(source.replace(/^﻿/, ''))
    const doc = parseLegal(source)
    const cfg = { ...doc.config, article: { ...doc.config.article, numeral: 'kanji' as const } }
    const label = (a: Article) => articleLabel(a.number, a.branch, cfg, a.branchPath)
    const out: string[] = []
    out.push(fm || `---\ntitle: ${JSON.stringify(doc.title)}\n---`, '')
    if (doc.title) out.push(`# ${doc.title}`, '')
    if (doc.preamble.trim()) out.push(doc.preamble.trim(), '')

    for (const ch of doc.chapters) {
        const deep = ch.kind === 'none' ? '##' : '###'
        if (ch.kind === 'chapter') out.push(`## ${[ch.label, ch.title].filter(Boolean).join('　')}`, '')
        else if (ch.kind === 'supplement') out.push(`## ${ch.title || '附　則'}`, '')
        else if (ch.kind === 'appendix' || ch.kind === 'closing') {
            if (ch.title) out.push(`## ${ch.title}`, '')
            if (ch.raw.trim()) out.push(ch.raw.trim(), '')
            continue
        }
        paragraphLines(ch.intro, doc, out, ch.kind === 'supplement' && ch.intro.length > 1)
        for (let i = 0; i < ch.articles.length; i++) {
            const a = ch.articles[i]
            if (a.deleted) {
                let j = i
                while (j + 1 < ch.articles.length && ch.articles[j + 1].deleted) j++
                const end = label(ch.articles[j])
                const head = j === i ? label(a) : j === i + 1 ? `${label(a)}及び${end}` : `${label(a)}から${end}まで`
                out.push(`${deep} ${head}`, '', '削除', '')
                i = j
                continue
            }
            out.push(`${deep} ${label(a)}${a.title ? `（${a.title}）` : ''}`, '')
            paragraphLines(a.paragraphs, doc, out, false)
        }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
