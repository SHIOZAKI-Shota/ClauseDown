import YAML from 'yaml'
import { t } from './i18n'

export interface DocConfig {
    doc: {
        style: 'auto' | 'ja' | 'contract' | 'us-law' | 'uk-law' | 'eu' | 'de' | 'fr' | 'decimal'
        contractType: 'section' | 'plain' | 'article'
    }
    chapter: { numeral: 'kanji' | 'arabic' | 'fullwidth' | 'none' }
    article: {
        numeral: 'kanji' | 'arabic' | 'fullwidth'
        title: 'above' | 'inline' | 'none'
        numbering: 'continuous' | 'perChapter'
    }
    paragraph: { firstNumbered: boolean; numeral: 'fullwidth' | 'arabic' | 'circled'; indent: 'nested' | 'flush'; hang: 'char' | 'text' }
    item: { style: 'kanji' | 'paren' | 'circled' }
    subitem: { style: 'iroha' | 'paren' | 'roman' }
}

export const CONTRACT_PRESET: Omit<DocConfig, 'doc'> = {
    chapter: { numeral: 'arabic' },
    article: { numeral: 'arabic', title: 'inline', numbering: 'continuous' },
    paragraph: { firstNumbered: false, numeral: 'arabic', indent: 'nested', hang: 'text' },
    item: { style: 'paren' },
    subitem: { style: 'iroha' },
}

export function presetOf(config: DocConfig): 'law' | 'contract' | null {
    const same = (a: Omit<DocConfig, 'doc'>) =>
        (['chapter', 'article', 'paragraph', 'item', 'subitem'] as const).every((k) => JSON.stringify(config[k]) === JSON.stringify(a[k]))
    if (same(DEFAULT_CONFIG)) return 'law'
    if (same(CONTRACT_PRESET)) return 'contract'
    return null
}

export const DEFAULT_CONFIG: DocConfig = {
    doc: { style: 'auto', contractType: 'section' },
    chapter: { numeral: 'kanji' },
    article: { numeral: 'arabic', title: 'above', numbering: 'continuous' },
    paragraph: { firstNumbered: false, numeral: 'fullwidth', indent: 'nested', hang: 'char' },
    item: { style: 'kanji' },
    subitem: { style: 'iroha' },
}

const c = () => t().config

// label と options は読むたびに今の言語で返す。番号の見本（第一章 など）は文書の書式なので訳さない
export const CONFIG_CHOICES = {
    'doc.style': {
        get label() {
            return c().docStyle
        },
        get options() {
            return c().docStyleOptions
        },
    },
    'doc.contractType': {
        get label() {
            return c().contractType
        },
        options: { section: 'Section 1', plain: '1.', article: 'Article 1' },
    },
    'chapter.numeral': {
        get label() {
            return c().chapterNumeral
        },
        get options() {
            return { kanji: '第一章', arabic: '第1章', fullwidth: '第１章', none: c().noNumber }
        },
    },
    'article.numeral': {
        get label() {
            return c().articleNumeral
        },
        options: { kanji: '第二条', arabic: '第2条', fullwidth: '第２条' },
    },
    'article.title': {
        get label() {
            return c().articleTitle
        },
        get options() {
            return c().articleTitleOptions
        },
    },
    'article.numbering': {
        get label() {
            return c().articleNumbering
        },
        get options() {
            return c().articleNumberingOptions
        },
    },
    'paragraph.firstNumbered': {
        get label() {
            return c().firstNumbered
        },
        get options() {
            return c().firstNumberedOptions
        },
    },
    'paragraph.numeral': {
        get label() {
            return c().paragraphNumeral
        },
        options: { fullwidth: '２', arabic: '2', circled: '②' },
    },
    'paragraph.indent': {
        get label() {
            return c().paragraphIndent
        },
        get options() {
            return c().paragraphIndentOptions
        },
    },
    'paragraph.hang': {
        get label() {
            return c().paragraphHang
        },
        get options() {
            return c().paragraphHangOptions
        },
    },
    'item.style': {
        get label() {
            return c().itemStyle
        },
        options: { kanji: '一', paren: '（1）', circled: '①' },
    },
    'subitem.style': {
        get label() {
            return c().subitemStyle
        },
        options: { iroha: 'イ', paren: '（1）', roman: '（i）' },
    },
} as const

export type ConfigKey = keyof typeof CONFIG_CHOICES

export const JA_ONLY_KEYS: ConfigKey[] = [
    'chapter.numeral',
    'article.numeral',
    'article.numbering',
    'paragraph.firstNumbered',
    'paragraph.numeral',
    'paragraph.indent',
    'paragraph.hang',
    'item.style',
    'subitem.style',
]

const BLOCK_RE = /<!--\s*clausedown\b([\s\S]*?)-->/
const FRONTMATTER_RE = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/

const isBooleanKey = (section: string, key: string) => typeof (DEFAULT_CONFIG as any)[section]?.[key] === 'boolean'

function normalizeValue(section: string, key: string, value: unknown): unknown {
    if (!isBooleanKey(section, key)) return String(value)
    return value === true || value === 'true' ? true : value === false || value === 'false' ? false : String(value)
}

export interface ConfigResult {
    config: DocConfig
    warnings: string[]
}

export function readConfig(md: string): ConfigResult {
    const warnings: string[] = []
    const config = structuredClone(DEFAULT_CONFIG)
    const m = BLOCK_RE.exec(md)
    if (!m) return { config, warnings }
    let raw: unknown
    try {
        raw = YAML.parse(m[1]) ?? {}
    } catch (e) {
        warnings.push(c().invalidYaml((e as Error).message))
        return { config, warnings }
    }
    if (typeof raw !== 'object' || raw === null) return { config, warnings }
    for (const [section, values] of Object.entries(raw as Record<string, unknown>)) {
        if (!Object.hasOwn(config, section)) {
            warnings.push(c().unknownKey(section))
            continue
        }
        if (typeof values !== 'object' || values === null) continue
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
            const full = `${section}.${key}` as ConfigKey
            const choice = Object.hasOwn(CONFIG_CHOICES, full) ? CONFIG_CHOICES[full] : undefined
            if (!choice) {
                warnings.push(c().unknownKey(full))
                continue
            }
            if (!Object.keys(choice.options).includes(String(value))) {
                warnings.push(c().invalidValue(choice.label, full, String(value)))
                continue
            }
            ;(config as any)[section][key] = normalizeValue(section, key, value)
        }
    }
    return { config, warnings }
}

export function getConfigValue(config: DocConfig, key: ConfigKey): string {
    const [section, name] = key.split('.')
    return String((config as any)[section][name])
}

export function setConfigValue(config: DocConfig, key: ConfigKey, value: string): DocConfig {
    const next = structuredClone(config)
    const [section, name] = key.split('.')
    ;(next as any)[section][name] = normalizeValue(section, name, value)
    return next
}

export function serializeConfig(config: DocConfig): string {
    const diff: Record<string, Record<string, unknown>> = {}
    for (const key of Object.keys(CONFIG_CHOICES) as ConfigKey[]) {
        const [section, name] = key.split('.')
        const value = (config as any)[section][name]
        if (value !== (DEFAULT_CONFIG as any)[section][name]) {
            ;(diff[section] ??= {})[name] = value
        }
    }
    if (Object.keys(diff).length === 0) return ''
    const lines = Object.entries(diff).map(
        ([section, values]) =>
            `${section}: { ${Object.entries(values)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(', ')} }`,
    )
    return lines.join('\n')
}

function titleEnd(md: string, from: number): number {
    let fence: string | null = null
    for (let at = from; at <= md.length;) {
        const nl = md.indexOf('\n', at)
        const end = nl < 0 ? md.length : nl
        const line = md.slice(at, end).replace(/\r$/, '')
        const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null
        } else if (f) fence = f[1]
        else if (line.startsWith('# ')) return at + line.length
        if (nl < 0) break
        at = nl + 1
    }
    return -1
}

export function writeConfig(md: string, config: DocConfig): string {
    const eol = md.includes('\r\n') ? '\r\n' : '\n'
    const body = serializeConfig(config)
    const block = body ? `<!-- clausedown${eol}${body.replace(/\n/g, eol)}${eol}-->` : ''
    if (BLOCK_RE.test(md)) {
        if (!block) return md.replace(new RegExp(BLOCK_RE.source + '\\r?\\n?'), '')
        return md.replace(BLOCK_RE, () => block)
    }
    if (!block) return md
    const fmEnd = FRONTMATTER_RE.exec(md)?.[0].length ?? 0
    const at = titleEnd(md, fmEnd)
    if (at >= 0) return `${md.slice(0, at)}${eol}${block}${md.slice(at)}`
    if (fmEnd) return `${md.slice(0, fmEnd)}${eol}${block}${md.slice(fmEnd)}`
    return `${block}${eol}${md}`
}
