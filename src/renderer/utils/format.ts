const pad = (n: number) => String(n).padStart(2, '0')

export function todayISO(): string {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDate(t: number | string): Date {
    return typeof t === 'number' ? new Date(t * 1000) : new Date(t)
}

export function fmtDate(t: number | string, kind: 'md' | 'ymd' | 'mdhm' | 'ymdhm'): string {
    const d = toDate(t)
    const md = `${d.getMonth() + 1}/${d.getDate()}`
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
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
export function fmtWareki(date: string): string {
    const t = Date.parse(`${date}T00:00:00Z`)
    return Number.isNaN(t) ? date : WAREKI.format(t)
}

export function relTime(ts: number): string {
    if (!ts) return ''
    const diff = (Date.now() - ts * 1000) / 1000
    if (diff < 60) return 'たった今'
    if (diff < 3600) return `${Math.floor(diff / 60)}分前`
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`
    return fmtDate(ts, 'ymd')
}

export function firstLine(m: string): string {
    return m.split(/\r?\n/)[0]
}

export function daysUntil(date: string, today = todayISO()): number {
    return Math.round((Date.parse(date) - Date.parse(today)) / 86400000)
}

export function untilLabel(n: number): string {
    return n === 0 ? '今日' : n === 1 ? '明日' : n > 0 ? `あと ${n} 日` : `${-n} 日前`
}

export function urgencyOf(n: number): '' | 'soon' | 'near' {
    return n < 0 ? '' : n <= 7 ? 'soon' : n <= 30 ? 'near' : ''
}
