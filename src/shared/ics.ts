import { addDays, type ScheduleItem } from './schedule'

const esc = (s: string) =>
    s
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/[;,]/g, (c) => `\\${c}`)
const ymd = (d: string) => d.replace(/-/g, '')
const enc = new TextEncoder()

function fold(line: string): string {
    const out: string[] = []
    let cur = ''
    let bytes = 0
    for (const ch of line) {
        const n = enc.encode(ch).length
        if (bytes + n > (out.length ? 74 : 75)) {
            out.push(cur)
            cur = ''
            bytes = 0
        }
        cur += ch
        bytes += n
    }
    out.push(cur)
    return out.join('\r\n ')
}

function uidOf(key: string): string {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 2654435761)
        h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
    return `${hex(h2)}${hex(h1)}@clausedown`
}

const stamp = (d: Date) =>
    d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z')

const trigger = (days: number) => (days === 0 ? 'PT9H' : `-PT${days * 24 - 9}H`)

const docName = (p: string) => (p ? p.replace(/\.md$/i, '').split('/').pop()! : 'リポジトリ全体')

export const exportable = (o: ScheduleItem) => o.source !== 'delivery' && !o.done

export function toIcs(items: ScheduleItem[], name: string, now = new Date()): string {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClauseDown//ClauseDown//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
    lines.push(`X-WR-CALNAME:${esc(name)}`)
    for (const o of items.filter(exportable)) {
        const head = o.title && o.title !== o.kindLabel ? `${o.kindLabel}：${o.title}` : o.kindLabel
        const summary = `${head}（${o.repo}）`
        const desc = [`リポジトリ：${o.repo}`, `文書：${docName(o.docPath)}`, o.note ? `\n${o.note}` : ''].filter(Boolean).join('\n')
        lines.push(
            'BEGIN:VEVENT',
            `UID:${uidOf(o.key)}`,
            `DTSTAMP:${stamp(now)}`,
            `DTSTART;VALUE=DATE:${ymd(o.date)}`,
            `DTEND;VALUE=DATE:${ymd(addDays(o.end ?? o.date, 1))}`,
            `SUMMARY:${esc(summary)}`,
            `DESCRIPTION:${esc(desc)}`,
            `CATEGORIES:${esc(o.kindLabel)}`,
            'TRANSP:TRANSPARENT',
        )
        if (o.remind >= 0) {
            lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, `TRIGGER:${trigger(o.remind)}`, 'END:VALARM')
        }
        lines.push('END:VEVENT')
    }
    lines.push('END:VCALENDAR')
    return lines.map(fold).join('\r\n') + '\r\n'
}
