import type { DocConfig } from './config'
import { formatNumber, toRoman, type NumeralStyle } from './numerals'
import { t } from './i18n'
import { liveRecord } from './i18n/live'

export const STYLE_IDS = ['ja', 'contract', 'us-law', 'uk-law', 'eu', 'de', 'fr', 'decimal'] as const
export type StyleId = (typeof STYLE_IDS)[number]
export type StyleChoice = 'auto' | StyleId
export type DocLang = 'ja' | 'en' | 'de' | 'fr'

// 画面に出す書式の名前。読むたびに今の言語で返す
export const STYLE_NAMES: Record<StyleId, string> = liveRecord(STYLE_IDS, (id) => t().styles.names[id])

export interface ArticleNo {
    number: number
    branch: number
    branchPath?: number[]
}

export interface RefPart {
    number: number
    label: string
}

export interface RefTarget {
    article: ArticleNo
    articleRef: string
    paragraph?: RefPart & { index: number; count: number }
    items: (RefPart & { level: number })[]
}

export interface CompareWords {
    revised: string
    current: string
    omitted: string
    removed: string
    added: string
    deletedText: string
    addedText: string
}

export interface ArticleHead {
    lines: string[]
    runIn: string | null
}

export interface LegalStyle {
    id: StyleId
    lang: DocLang
    sep: string
    perChapter: boolean
    resetInSupplement: boolean
    chapterLabel(n: number, config: DocConfig): string
    articleLabel(a: ArticleNo, chapterNo: number, config: DocConfig): string
    articleRef(a: ArticleNo, chapterNo: number, config: DocConfig, inSupplement: boolean): string
    paragraphNumbered(index: number, count: number, explicit: boolean, config: DocConfig): boolean
    paragraphLabel(n: number, path: number[] | undefined, a: ArticleNo | null, chapterNo: number, config: DocConfig): string
    itemLabel(n: number, path: number[] | undefined, level: number, config: DocConfig): string
    ref(t: RefTarget, config: DocConfig): string
    headKind: 'ja' | 'runin' | 'stacked'
    headLabel(label: string): string
    titleSuffix(title: string): string
    titleUpper: boolean
    head(label: string, title: string, firstLabeled: boolean): ArticleHead
    deletedWord: string
    deletedLine(label: string): string
    supplementName: string
    appendixName: string
    compare: CompareWords
}

const JA_WORDS: CompareWords = {
    revised: '改正後',
    current: '改正前',
    omitted: '（略）',
    removed: '（削る）',
    added: '（新設）',
    deletedText: '削除文字',
    addedText: '追加文字',
}
const EN_WORDS: CompareWords = {
    revised: 'Revised',
    current: 'Current',
    omitted: '(Omitted)',
    removed: '(Deleted)',
    added: '(New)',
    deletedText: 'Deleted text',
    addedText: 'Added text',
}
const DE_WORDS: CompareWords = {
    revised: 'Neue Fassung',
    current: 'Bisherige Fassung',
    omitted: '(ausgelassen)',
    removed: '(gestrichen)',
    added: '(neu)',
    deletedText: 'Gestrichener Text',
    addedText: 'Eingefügter Text',
}
const FR_WORDS: CompareWords = {
    revised: 'Nouvelle rédaction',
    current: 'Rédaction actuelle',
    omitted: '(Omis)',
    removed: '(Supprimé)',
    added: '(Nouveau)',
    deletedText: 'Texte supprimé',
    addedText: 'Texte ajouté',
}

export const compareWords = (lang: DocLang | undefined): CompareWords =>
    lang === 'en' ? EN_WORDS : lang === 'de' ? DE_WORDS : lang === 'fr' ? FR_WORDS : JA_WORDS

const branchSuffixJa = (path: number[] | undefined, style: NumeralStyle) => (path ?? []).map((b) => `の${formatNumber(b, style)}`).join('')

function jaSubitemStyles(config: DocConfig): NumeralStyle[] {
    const order: NumeralStyle[] = ['iroha', 'paren', 'roman']
    const first = config.subitem.style as NumeralStyle
    return [first, ...order.filter((s) => s !== first)]
}

const ja: LegalStyle = {
    id: 'ja',
    lang: 'ja',
    sep: '　',
    perChapter: false,
    resetInSupplement: true,
    chapterLabel: (n, config) => (config.chapter.numeral === 'none' ? '' : `第${formatNumber(n, config.chapter.numeral as NumeralStyle)}章`),
    articleLabel(a, _ch, config) {
        const style = config.article.numeral as NumeralStyle
        const base = `第${formatNumber(a.number, style)}条`
        if (a.branchPath?.length) return base + branchSuffixJa(a.branchPath, style)
        return a.branch > 0 ? `${base}の${formatNumber(a.branch + 1, style)}` : base
    },
    articleRef(a, ch, config, inSupplement) {
        const label = ja.articleLabel(a, ch, config)
        return inSupplement ? `附則${label}` : label
    },
    paragraphNumbered: (index, _count, explicit, config) => index > 0 || config.paragraph.firstNumbered || explicit,
    paragraphLabel(n, path, _a, _ch, config) {
        const style = config.paragraph.numeral as NumeralStyle
        return formatNumber(n, style) + branchSuffixJa(path, style === 'circled' ? 'arabic' : style)
    },
    itemLabel(n, path, level, config) {
        const styles = jaSubitemStyles(config)
        const style: NumeralStyle = level === 1 ? (config.item.style as NumeralStyle) : styles[Math.min(level - 2, styles.length - 1)]
        return formatNumber(n, style) + branchSuffixJa(path, style === 'kanji' ? 'kanji' : 'arabic')
    },
    ref(t, config) {
        const style = config.article.numeral as NumeralStyle
        let out = t.articleRef
        if (t.paragraph) out += `第${formatNumber(t.paragraph.number, style)}項`
        t.items.forEach((it, i) => {
            out += i === 0 ? `第${formatNumber(it.number, style)}号` : it.label
        })
        return out
    },
    headKind: 'ja',
    headLabel: (label) => label,
    titleSuffix: () => '',
    titleUpper: false,
    head: (label) => ({ lines: [], runIn: label }),
    deletedWord: '削除',
    deletedLine: (label) => `${label}　削除`,
    supplementName: '附則',
    appendixName: '別表',
    compare: JA_WORDS,
}

const lower = (n: number) => {
    let out = ''
    let rest = n
    while (rest > 0) {
        out = String.fromCharCode(97 + ((rest - 1) % 26)) + out
        rest = Math.floor((rest - 1) / 26)
    }
    return out || String(n)
}
const upper = (n: number) => lower(n).toUpperCase()
const romanLower = (n: number) => toRoman(n)
const romanUpper = (n: number) => toRoman(n).toUpperCase()
const doubled = (n: number) => lower(n).repeat(2)
const tripled = (n: number) => lower(n).repeat(3)

type Marker = (n: number) => string
const paren = (f: Marker) => (n: number) => `(${f(n)})`
const close = (f: Marker) => (n: number) => `${f(n)})`
const dot = (f: Marker) => (n: number) => `${f(n)}.`
const arabic: Marker = (n) => String(n)

function withBranch(label: string, path: number[] | undefined): string {
    if (!path?.length) return label
    const mark = path.map((b) => `-${b}`).join('')
    const m = /^(\(?)(.*?)([.)°]?\)?)$/.exec(label)
    return m ? `${m[1]}${m[2]}${mark}${m[3]}` : `${label}${mark}`
}

const LATIN_BIS = ['', '', 'bis', 'ter', 'quater', 'quinquies', 'sexies', 'septies', 'octies', 'nonies', 'decies']

function core(a: ArticleNo, letters: 'upper' | 'lower' | 'latin'): string {
    const path = a.branchPath?.length ? a.branchPath : a.branch > 0 ? [a.branch + 1] : []
    if (!path.length) return String(a.number)
    const [first, ...rest] = path
    const tail = rest.map((b) => `-${b}`).join('')
    if (letters === 'latin') return `${a.number} ${LATIN_BIS[first] ?? `${first}`}${tail}`
    const l = lower(first - 1)
    return `${a.number}${letters === 'upper' ? l.toUpperCase() : l}${tail}`
}

const FR_ORDINAL = [
    '',
    'premier',
    'deuxième',
    'troisième',
    'quatrième',
    'cinquième',
    'sixième',
    'septième',
    'huitième',
    'neuvième',
    'dixième',
    'onzième',
    'douzième',
    'treizième',
    'quatorzième',
    'quinzième',
    'seizième',
    'dix-septième',
    'dix-huitième',
    'dix-neuvième',
    'vingtième',
]
const frOrdinal = (n: number) => FR_ORDINAL[n] ?? `${n}e`

interface LatinSpec {
    id: StyleId
    lang: DocLang
    chapter: Marker
    article: (c: string) => string
    articleRef: (c: string) => string
    letters: 'upper' | 'lower' | 'latin'
    paragraph: ((n: number, articleCore: string) => string) | null
    items: Marker[]
    ref: (t: RefTarget) => string
    headKind: 'runin' | 'stacked'
    headLabel?: (label: string) => string
    titlePeriod?: boolean
    titleUpper?: boolean
    deleted: string
    perChapter?: boolean
    resetInSupplement?: boolean
    supplementName: string
    appendixName: string
}

function latin(spec: LatinSpec): LegalStyle {
    const articleCore = (a: ArticleNo, ch: number) => {
        const c = core(a, spec.letters)
        return spec.perChapter && ch > 0 ? `${ch}.${c}` : c
    }
    const headLabel = spec.headLabel ?? ((label: string) => label)
    const titleSuffix = (title: string) => (spec.titlePeriod && !/[.!?:;]$/.test(title.trim()) ? '.' : '')
    return {
        id: spec.id,
        lang: spec.lang,
        sep: ' ',
        perChapter: !!spec.perChapter,
        resetInSupplement: !!spec.resetInSupplement,
        chapterLabel: (n) => spec.chapter(n),
        articleLabel: (a, ch) => spec.article(articleCore(a, ch)),
        articleRef: (a, ch) => spec.articleRef(articleCore(a, ch)),
        paragraphNumbered: (_index, count, explicit) => explicit || (spec.paragraph !== null && count > 1),
        paragraphLabel: (n, path, a, ch) => (spec.paragraph ? withBranch(spec.paragraph(n, a ? articleCore(a, ch) : ''), path) : ''),
        itemLabel(n, path, level) {
            const f = spec.items[Math.min(level - 1, spec.items.length - 1)]
            return withBranch(f(n), path)
        },
        ref: (t) => spec.ref(t),
        headKind: spec.headKind,
        headLabel,
        titleSuffix,
        titleUpper: !!spec.titleUpper,
        head(label, title, firstLabeled) {
            const l = headLabel(label)
            const t = title ? `${spec.titleUpper ? title.toUpperCase() : title}${titleSuffix(title)}` : ''
            if (spec.headKind === 'stacked') return { lines: t ? [l, t] : [l], runIn: null }
            const full = t ? `${l} ${t}` : l
            return t && (firstLabeled || !spec.titlePeriod) ? { lines: [full], runIn: null } : { lines: [], runIn: full }
        },
        deletedWord: spec.deleted,
        deletedLine: (label) => `${headLabel(label)} ${spec.deleted}`,
        supplementName: spec.supplementName,
        appendixName: spec.appendixName,
        compare: compareWords(spec.lang),
    }
}

const titled = (label: string) => (label.endsWith('.') ? label : `${label}.`)

const contractRef = (prefix: string) => (t: RefTarget) => {
    const items = t.items.map((i) => i.label).join('')
    if (t.paragraph?.label) return `${prefix}${t.paragraph.label}${items}`
    return `${t.articleRef}${items}`
}

const nested = (t: RefTarget) => `${t.articleRef}${t.paragraph?.label ?? ''}${t.items.map((i) => i.label).join('')}`

function contract(type: 'section' | 'plain' | 'article'): LegalStyle {
    const word = type === 'article' ? 'Article' : 'Section'
    return latin({
        id: 'contract',
        lang: 'en',
        chapter: (n) => (type === 'section' ? `Article ${n}` : `Part ${n}`),
        article: (c) => (type === 'plain' ? `${c}.` : `${word} ${c}`),
        articleRef: (c) => `${word} ${c}`,
        letters: 'upper',
        paragraph: (n, c) => (c ? `${c}.${n}` : `${n}.`),
        items: [paren(lower), paren(romanLower), paren(upper), paren(romanUpper)],
        ref: contractRef(`${word} `),
        headKind: 'runin',
        headLabel: titled,
        titlePeriod: true,
        deleted: '[Reserved]',
        supplementName: 'Transitional Provisions',
        appendixName: 'Exhibit',
    })
}

const usLaw = latin({
    id: 'us-law',
    lang: 'en',
    chapter: (n) => `TITLE ${romanUpper(n)}`,
    article: (c) => `SEC. ${c}.`,
    articleRef: (c) => `section ${c}`,
    letters: 'upper',
    paragraph: (n) => `(${lower(n)})`,
    items: [paren(arabic), paren(upper), paren(romanLower), paren(romanUpper), paren(doubled)],
    ref: nested,
    headKind: 'runin',
    titlePeriod: true,
    titleUpper: true,
    deleted: '[Reserved]',
    supplementName: 'Effective Date',
    appendixName: 'Schedule',
})

const ukLaw = latin({
    id: 'uk-law',
    lang: 'en',
    chapter: (n) => `PART ${n}`,
    article: (c) => c,
    articleRef: (c) => `section ${c}`,
    letters: 'upper',
    paragraph: (n) => `(${n})`,
    items: [paren(lower), paren(romanLower), paren(upper), paren(romanUpper)],
    ref: nested,
    headKind: 'runin',
    deleted: '[Repealed]',
    supplementName: 'Transitional Provisions',
    appendixName: 'Schedule',
})

const eu = latin({
    id: 'eu',
    lang: 'en',
    chapter: (n) => `CHAPTER ${romanUpper(n)}`,
    article: (c) => `Article ${c}`,
    articleRef: (c) => `Article ${c}`,
    letters: 'lower',
    paragraph: (n) => `${n}.`,
    items: [paren(lower), paren(romanLower), () => '—'],
    ref(t) {
        const para = t.paragraph?.label ? `(${t.paragraph.label.replace(/\.$/, '')})` : ''
        const base = `${t.articleRef}${para}`
        if (!t.items.length) return base
        return `point ${t.items.map((i) => i.label).join('')} of ${base}`
    },
    headKind: 'stacked',
    deleted: '[deleted]',
    supplementName: 'Final Provisions',
    appendixName: 'Annex',
})

const DE_LEVEL = ['Nummer', 'Buchstabe', 'Doppelbuchstabe', 'Dreifachbuchstabe']

const de = latin({
    id: 'de',
    lang: 'de',
    chapter: (n) => `Abschnitt ${n}`,
    article: (c) => `§ ${c}`,
    articleRef: (c) => `§ ${c}`,
    letters: 'lower',
    paragraph: (n) => `(${n})`,
    items: [dot(arabic), close(lower), close(doubled), close(tripled)],
    ref(t) {
        let out = t.articleRef
        if (t.paragraph?.label) out += ` Absatz ${t.paragraph.label.replace(/[()]/g, '')}`
        t.items.forEach((it, i) => {
            out += ` ${DE_LEVEL[Math.min(i, DE_LEVEL.length - 1)]} ${it.label.replace(/[.)]$/, '')}`
        })
        return out
    },
    headKind: 'runin',
    deleted: '(weggefallen)',
    supplementName: 'Übergangsvorschriften',
    appendixName: 'Anlage',
})

const fr = latin({
    id: 'fr',
    lang: 'fr',
    chapter: (n) => `Chapitre ${n === 1 ? 'Ier' : romanUpper(n)}`,
    article: (c) => `Article ${c === '1' ? '1er' : c}`,
    articleRef: (c) => `article ${c === '1' ? '1er' : c}`,
    letters: 'latin',
    paragraph: null,
    items: [(n) => `${n}°`, close(lower), close(romanLower)],
    ref(t) {
        const article = `l'${t.articleRef}`
        const alinea = t.paragraph && t.paragraph.count > 1 ? `${frOrdinal(t.paragraph.index + 1)} alinéa` : ''
        const parts = [...t.items].reverse().map((i) => i.label.replace(/\)$/, ''))
        if (!parts.length) return alinea ? `${alinea} de ${article}` : t.articleRef
        const head = parts[0]
        const middle = parts.slice(1).map((p) => `du ${p}`)
        const tail = alinea ? [`du ${alinea}`, `de ${article}`] : [`de ${article}`]
        return [head, ...middle, ...tail].join(' ')
    },
    headKind: 'stacked',
    deleted: '(abrogé)',
    supplementName: 'Dispositions transitoires',
    appendixName: 'Annexe',
})

function decimal(lang: DocLang): LegalStyle {
    const en = lang !== 'ja'
    return latin({
        id: 'decimal',
        lang,
        chapter: (n) => `${n}`,
        article: (c) => c,
        articleRef: (c) => c,
        letters: 'upper',
        paragraph: null,
        items: [close(lower), close(arabic), () => '—'],
        ref: (t) => [t.articleRef, ...t.items.map((i) => i.label)].join(' '),
        headKind: 'runin',
        deleted: en ? '(Deleted)' : '(削除)',
        perChapter: true,
        resetInSupplement: true,
        supplementName: en ? 'Supplementary Provisions' : '附則',
        appendixName: en ? 'Annex' : '附属書',
    })
}

const FIXED: Record<Exclude<StyleId, 'contract' | 'decimal'>, LegalStyle> = { ja, 'us-law': usLaw, 'uk-law': ukLaw, eu, de, fr }
const CONTRACTS = { section: contract('section'), plain: contract('plain'), article: contract('article') }
const DECIMALS = { ja: decimal('ja'), en: decimal('en'), de: decimal('de'), fr: decimal('fr') }

export function legalStyle(id: StyleId, config: DocConfig, detected: DocLang = 'ja'): LegalStyle {
    if (id === 'contract') return CONTRACTS[config.doc?.contractType ?? 'section'] ?? CONTRACTS.section
    if (id === 'decimal') return DECIMALS[detected]
    return FIXED[id]
}

export const SPELL_LANGS = ['en-US', 'en-GB', 'de-DE', 'fr-FR'] as const
export type SpellLang = (typeof SPELL_LANGS)[number]

export function spellLang(id: StyleId | undefined, lang: DocLang | undefined): SpellLang | null {
    if (!id || id === 'ja') return null
    if (id === 'uk-law' || id === 'eu') return 'en-GB'
    if (lang === 'de') return 'de-DE'
    if (lang === 'fr') return 'fr-FR'
    return lang === 'en' ? 'en-US' : null
}

const MASKS = [
    /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/g,
    /<!--[\s\S]*?-->/g,
    /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*$/gm,
    /\[\[[^\]\n]*\]\]/g,
    /\{[^{}\n]*\}/g,
    /https?:\/\/\S+/g,
    /!?\[[^\]\n]*\]\([^)\n]*\)/g,
]

export const MIN_DETECT_CHARS = 200
export const LATIN_RATIO = 0.7

export function detectLang(source: string, minChars = MIN_DETECT_CHARS): DocLang {
    let text = source
    for (const re of MASKS) text = text.replace(re, ' ')
    const cjk = (text.match(/[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/g) ?? []).length
    const latinChars = (text.match(/[A-Za-zÀ-ɏ]/g) ?? []).length
    const total = cjk + latinChars
    if (total < Math.max(1, minChars)) return 'ja'
    return latinChars / total >= LATIN_RATIO ? 'en' : 'ja'
}

export function resolveStyle(config: DocConfig, source: string): { id: StyleId; lang: DocLang } {
    const choice = (config.doc?.style ?? 'auto') as StyleChoice
    const detected = detectLang(source)
    const id: StyleId = choice === 'auto' ? (detected === 'en' ? 'contract' : 'ja') : choice
    const style = legalStyle(id, config, id === 'decimal' ? detectLang(source, 20) : detected)
    return { id, lang: style.lang }
}
