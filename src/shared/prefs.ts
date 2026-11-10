import { fontNames } from './fonts'

export interface DocStyle {
    font: string
    fontSize: number
    lineHeight: number
    margin: number
    pageNumbers: boolean
    newDocPreset: 'law' | 'contract'
}

export const DEFAULT_STYLE: DocStyle = {
    font: '游明朝',
    fontSize: 10.5,
    lineHeight: 1.8,
    margin: 20,
    pageNumbers: true,
    newDocPreset: 'law',
}

export interface AppPrefs {
    uiScale: number
    editorFont: string
    editorFontSize: number
    lineNumbers: boolean
    lineWrap: boolean
    numberHints: boolean
    proofread: boolean
    syncOnStart: boolean
    pushOnSave: boolean
    exportDir: string
    exportDateSuffix: boolean
    docStyle: DocStyle
    notifyDue: boolean
    reopenLastDoc: boolean
    typesetCss: string
    previewZoom: number
    zoomLinked: boolean
    compareStyle: 'table' | 'inline'
    previewKind: 'normal' | 'print'
    lastDoc?: { dir: string; path: string }
    recentDocs?: RecentDoc[]
}

export interface RecentDoc {
    dir: string
    path: string
    title: string
    at: number
}

export const DEFAULT_PREFS: AppPrefs = {
    uiScale: 100,
    editorFont: 'BIZ UDゴシック',
    editorFontSize: 14,
    lineNumbers: true,
    lineWrap: true,
    numberHints: true,
    proofread: true,
    syncOnStart: true,
    pushOnSave: true,
    exportDir: '',
    exportDateSuffix: false,
    docStyle: DEFAULT_STYLE,
    notifyDue: true,
    reopenLastDoc: true,
    typesetCss: '',
    previewZoom: 100,
    zoomLinked: false,
    compareStyle: 'table',
    previewKind: 'normal',
}


export const BODY_FONTS = ['游明朝', 'BIZ UD明朝 Medium', 'ＭＳ 明朝', 'ＭＳ Ｐ明朝', 'ヒラギノ明朝 ProN', 'Noto Serif JP', '游ゴシック', 'BIZ UDゴシック', 'メイリオ', 'ＭＳ ゴシック', 'ヒラギノ角ゴシック']
export const EDITOR_FONTS = ['BIZ UDゴシック', 'ＭＳ ゴシック', 'Cascadia Mono', 'Consolas', 'Noto Sans Mono CJK JP', 'HackGen', 'HackGen Console NF', 'UDEV Gothic', 'メイリオ', '游ゴシック', 'ヒラギノ角ゴシック']

const num = (v: unknown, min: number, max: number, d: number) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d
}

export function cleanStyle(s: Partial<DocStyle> | null | undefined): DocStyle {
    const font = String(s?.font ?? '').replace(/[^\p{L}\p{N} _\-・]/gu, '').trim().slice(0, 64)
    return {
        font: font || DEFAULT_STYLE.font,
        fontSize: num(s?.fontSize, 6, 30, DEFAULT_STYLE.fontSize),
        lineHeight: num(s?.lineHeight, 1, 3, DEFAULT_STYLE.lineHeight),
        margin: num(s?.margin, 5, 50, DEFAULT_STYLE.margin),
        pageNumbers: s?.pageNumbers !== false,
        newDocPreset: s?.newDocPreset === 'contract' ? 'contract' : 'law',
    }
}

export function cssFont(name: string, kind: 'serif' | 'mono' = 'serif'): string {
    const fallback = kind === 'mono' ? ['BIZ UDGothic', 'MS Gothic'] : ['Yu Mincho', 'YuMincho', 'MS Mincho']
    const names = new Set([...fontNames(name.replace(/["\\<>;{}]/g, '')), ...fallback])
    return `${[...names].map((n) => `"${n}"`).join(', ')}, ${kind === 'mono' ? 'monospace' : 'serif'}`
}

export function styleVars(s: DocStyle): string {
    return `--cd-font: ${cssFont(s.font)}; --cd-size: ${s.fontSize}pt; --cd-line: ${s.lineHeight};`
}

export function withDefaults<T extends object>(defaults: T, value: Partial<T> | null | undefined): T {
    return { ...defaults, ...(value ?? {}) }
}
