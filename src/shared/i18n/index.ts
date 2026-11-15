import { ja } from './ja'
import { en } from './en'
import type { Messages } from './types'

export type { Messages } from './types'
export const LOCALES = ['ja', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export type LanguagePref = 'system' | Locale

const DICTS: Record<Locale, Messages> = { ja, en }

let current: Locale = 'ja'
const listeners = new Set<(l: Locale) => void>()

export function resolveLocale(pref: LanguagePref | undefined, systemLanguages: readonly string[] = []): Locale {
    if (pref === 'ja' || pref === 'en') return pref
    const first = systemLanguages.find((l) => typeof l === 'string' && l.trim())
    return first && /^ja\b/i.test(first) ? 'ja' : first ? 'en' : 'ja'
}

export function setLocale(l: Locale): void {
    if (l === current || !DICTS[l]) return
    current = l
    for (const fn of listeners) fn(l)
}

export const locale = (): Locale => current

// 今の言語の辞書。renderer の画面では useT() を使う（言語の切り替えに追従する）
export const t = (): Messages => DICTS[current]

export const messagesOf = (l: Locale): Messages => DICTS[l] ?? DICTS.ja

export function onLocale(fn: (l: Locale) => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}
