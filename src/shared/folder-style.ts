import { cleanStyle, DEFAULT_STYLE, type DocStyle } from './prefs'

export const APP_DIR = '.clausedown'

export const styleFileOf = (folder: string) => (folder ? `${APP_DIR}/styles/${folder}.json` : `${APP_DIR}/style.json`)

export type StyleOverride = Partial<DocStyle>
export type StyleLayers = Record<string, StyleOverride>
// 'app'（アプリの設定）か、設定を持つディレクトリのパス
export type StyleSource = string

export const STYLE_KEYS = Object.keys(DEFAULT_STYLE) as (keyof DocStyle)[]

export function cleanOverride(o: unknown): StyleOverride {
    if (!o || typeof o !== 'object') return {}
    const src = o as Record<string, unknown>
    const clean = cleanStyle(src as Partial<DocStyle>)
    const out: StyleOverride = {}
    for (const k of STYLE_KEYS) if (k in src && src[k] !== undefined && src[k] !== null) (out as Record<string, unknown>)[k] = clean[k]
    return out
}

export function folderChain(path: string, isFolder = false): string[] {
    const parts = path.split('/').filter(Boolean)
    if (!isFolder) parts.pop()
    const out = ['']
    for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'))
    return out
}

export interface ResolvedStyle {
    style: DocStyle
    from: Record<keyof DocStyle, StyleSource>
}

function resolveChain(base: DocStyle, layers: StyleLayers, chain: string[]): ResolvedStyle {
    const style = { ...DEFAULT_STYLE, ...cleanStyle(base) }
    const from = Object.fromEntries(STYLE_KEYS.map((k) => [k, 'app'])) as Record<keyof DocStyle, StyleSource>
    for (const folder of chain) {
        const layer = layers[folder]
        if (!layer) continue
        for (const k of STYLE_KEYS) {
            if (layer[k] === undefined) continue
            ;(style as Record<string, unknown>)[k] = layer[k]
            from[k] = folder
        }
    }
    return { style, from }
}

export function resolveStyle(base: DocStyle, layers: StyleLayers, docPath: string): ResolvedStyle {
    return resolveChain(base, layers, folderChain(docPath))
}

export function inheritedStyle(base: DocStyle, layers: StyleLayers, folder: string): ResolvedStyle {
    return resolveChain(
        base,
        layers,
        folderChain(folder, true).filter((f) => f !== folder),
    )
}

export function sourceLabel(src: StyleSource): string {
    if (src === 'app') return 'ローカル の設定'
    if (src === '') return 'リポジトリの設定'
    return `「${src}」の設定`
}
