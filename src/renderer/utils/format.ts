import { locale, t } from '@shared/i18n'
import { localHm, todayISO } from '@shared/date'

function toDate(t: number | string): Date {
    return typeof t === 'number' ? new Date(t * 1000) : new Date(t)
}

export function fmtDate(t: number | string, kind: 'md' | 'ymd' | 'mdhm' | 'ymdhm'): string {
    const d = toDate(t)
    const md = `${d.getMonth() + 1}/${d.getDate()}`
    const hm = localHm(d)
    switch (kind) {
        case 'md':
            return md
        case 'ymd':
            return `${d.getFullYear()}/${md}`
        case 'mdhm':
            return `${md} ${hm}`
        case 'ymdhm':
            return `${d.getFullYear()}/${md} ${hm}`
    }
}

const WAREKI = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
const EN_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
// 日本語の画面では和暦、英語の画面では「Apr 1, 2026」
export function fmtWareki(date: string): string {
    const ms = Date.parse(`${date}T00:00:00Z`)
    return Number.isNaN(ms) ? date : (locale() === 'ja' ? WAREKI : EN_DATE).format(ms)
}

export function relTime(ts: number): string {
    if (!ts) return ''
    const diff = (Date.now() - ts * 1000) / 1000
    const r = t().common.relTime
    if (diff < 60) return r.justNow
    if (diff < 3600) return r.minutes(Math.floor(diff / 60))
    if (diff < 86400) return r.hours(Math.floor(diff / 3600))
    if (diff < 86400 * 7) return r.days(Math.floor(diff / 86400))
    return fmtDate(ts, 'ymd')
}

export function firstLine(m: string): string {
    return m.split(/\r?\n/)[0]
}

export function daysUntil(date: string, today = todayISO()): number {
    return Math.round((Date.parse(date) - Date.parse(today)) / 86400000)
}

export function untilLabel(n: number): string {
    const u = t().common.until
    return n === 0 ? u.today : n === 1 ? u.tomorrow : n > 0 ? u.inDays(n) : u.daysAgo(-n)
}

export function urgencyOf(n: number): '' | 'soon' | 'near' {
    return n < 0 ? '' : n <= 7 ? 'soon' : n <= 30 ? 'near' : ''
}
