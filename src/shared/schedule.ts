import { t, type Messages } from './i18n'
import { liveRecord } from './i18n/live'

export interface EventKind {
    id: string
    label: string
    color: KindColor
    task: boolean
    remind: number
}

export interface DueEvent {
    id: string
    kind: string
    title?: string
    note?: string
    docPath: string
    date: string
    end?: string
    repeat?: { every: 'year' | 'month'; until?: string }
    remind?: number
    done: string[]
    deleted?: true
    by: string
    at: string
    updatedAt: string
}

export type DueEventInput = Pick<DueEvent, 'kind' | 'docPath' | 'date'> & Partial<Pick<DueEvent, 'id' | 'title' | 'note' | 'end' | 'repeat' | 'remind'>>

export interface Occurrence {
    key: string
    source: 'event' | 'tag' | 'delivery'
    id: string
    kind: string
    title: string
    docPath: string
    date: string
    end?: string
    task: boolean
    done: boolean
    overdue: boolean
    repeat: boolean
    remind: number
    note?: string
    oid?: string
}

export interface ScheduleItem extends Occurrence {
    dir: string
    repo: string
    kindLabel: string
    color: KindColor
}

export interface RepoSchedule {
    dir: string
    name: string
    kinds: EventKind[]
    events: DueEvent[]
    docs: { path: string; title: string }[]
}

export const KIND_COLORS = {
    blue: '#2563eb',
    sky: '#0284c7',
    teal: '#0d9488',
    green: '#16a34a',
    amber: '#d97706',
    orange: '#ea580c',
    red: '#dc2626',
    pink: '#db2777',
    violet: '#7c3aed',
    slate: '#64748b',
} as const
export type KindColor = keyof typeof KIND_COLORS
// 読むたびに今の言語で返す
export const COLOR_LABEL: Record<KindColor, string> = liveRecord(Object.keys(KIND_COLORS) as KindColor[], (c) => t().labels.colors[c])

export const EFFECTIVE_KIND = 'effective'
export const DELIVERY_KIND = 'delivery'

type KindName = keyof Messages['labels']['kinds']

// 既定の種類の名前は今の言語で返す。{ ...k } で写すと、その時点の言語の名前で固まる（保存される）
const kind = (id: KindName, color: KindColor, task: boolean, remind: number): EventKind => ({
    id,
    get label() {
        return t().labels.kinds[id]
    },
    color,
    task,
    remind,
})

export const DEFAULT_KINDS: EventKind[] = [
    kind(EFFECTIVE_KIND, 'blue', false, 30),
    kind('promulgate', 'violet', false, 0),
    kind('submit', 'orange', true, 7),
    kind('notify', 'amber', true, 14),
    kind('apply', 'pink', true, 14),
    kind('start', 'green', false, 0),
    kind('end', 'slate', false, 30),
    kind('renew', 'teal', true, 60),
    kind('deadline', 'red', true, 7),
]
const DELIVERY: EventKind = kind(DELIVERY_KIND, 'sky', false, -1)

export function cleanKinds(v: unknown): EventKind[] {
    if (!Array.isArray(v)) return DEFAULT_KINDS.map((k) => ({ ...k }))
    const out: EventKind[] = []
    const seen = new Set<string>()
    for (const k of v as Partial<EventKind>[]) {
        if (!k || typeof k.id !== 'string' || !k.id || seen.has(k.id) || k.id === DELIVERY_KIND) continue
        const label = String(k.label ?? '')
            .trim()
            .slice(0, 20)
        if (!label) continue
        seen.add(k.id)
        out.push({
            id: k.id,
            label,
            color: k.color && k.color in KIND_COLORS ? k.color : 'slate',
            task: !!k.task,
            remind: Number.isInteger(k.remind) ? Math.max(-1, Math.min(365, k.remind as number)) : 0,
        })
    }
    if (!seen.has(EFFECTIVE_KIND)) out.unshift({ ...DEFAULT_KINDS[0] })
    return out
}

export function kindMap(kinds: EventKind[]): (id: string) => EventKind {
    const m = new Map([...kinds, DELIVERY].map((k) => [k.id, k]))
    return (id) => m.get(id) ?? { id, label: t().labels.kinds.fallback, color: 'slate', task: false, remind: 0 }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDate = (s: unknown): s is string => typeof s === 'string' && DATE_RE.test(s) && fromDayNum(dayNum(s)) === s
const pad = (n: number) => String(n).padStart(2, '0')
export const dayNum = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000)
export function fromDayNum(n: number): string {
    const d = new Date(n * 86400000)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
export const addDays = (s: string, n: number) => fromDayNum(dayNum(s) + n)

export function addMonths(s: string, months: number): string {
    const [y, m, d] = s.split('-').map(Number)
    const idx = y * 12 + (m - 1) + months
    const ny = Math.floor(idx / 12)
    const nm = idx - ny * 12
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
    return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`
}

export function cleanEventInput(v: DueEventInput): DueEventInput {
    const err = t().labels.eventErrors
    if (!v || typeof v !== 'object') throw new Error(err.invalid)
    if (typeof v.kind !== 'string' || !v.kind) throw new Error(err.noKind)
    if (!isDate(v.date)) throw new Error(err.badDate)
    if (v.end !== undefined && v.end !== '' && !isDate(v.end)) throw new Error(err.badEnd)
    const end = v.end && v.end !== v.date ? v.end : undefined
    if (end && end < v.date) throw new Error(err.endBeforeStart)
    let repeat: DueEvent['repeat']
    if (v.repeat) {
        if (v.repeat.every !== 'year' && v.repeat.every !== 'month') throw new Error(err.badRepeat)
        const until = v.repeat.until || undefined
        if (until !== undefined && (!isDate(until) || until < v.date)) throw new Error(err.badUntil)
        repeat = { every: v.repeat.every, ...(until ? { until } : {}) }
    }
    const docPath = typeof v.docPath === 'string' ? v.docPath : ''
    if (docPath.includes('..') || docPath.startsWith('/')) throw new Error(err.badDoc)
    const str = (s: unknown, max: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : undefined)
    const remind = v.remind === undefined || v.remind === null ? undefined : Math.max(-1, Math.min(365, Math.trunc(Number(v.remind)) || 0))
    return {
        ...(typeof v.id === 'string' && /^[\w-]+$/.test(v.id) ? { id: v.id } : {}),
        kind: v.kind,
        docPath,
        date: v.date,
        ...(end ? { end } : {}),
        ...(repeat ? { repeat } : {}),
        ...(remind !== undefined ? { remind } : {}),
        ...(str(v.title, 100) ? { title: str(v.title, 100) } : {}),
        ...(str(v.note, 2000) ? { note: str(v.note, 2000) } : {}),
    }
}

const MAX_REPEAT = 1200
export const OVERDUE_LOOKBACK = { month: 90, year: 400 } as const

export function expand(events: DueEvent[], kinds: EventKind[], from: string, to: string, today: string): Occurrence[] {
    const kindOf = kindMap(kinds)
    const out: Occurrence[] = []
    for (const e of events) {
        if (e.deleted || !isDate(e.date)) continue
        const k = kindOf(e.kind)
        const span = e.end && isDate(e.end) && e.end > e.date ? dayNum(e.end) - dayNum(e.date) : 0
        const step = e.repeat?.every === 'year' ? 12 : e.repeat?.every === 'month' ? 1 : 0
        const done = new Set(Array.isArray(e.done) ? e.done : [])
        const stale = e.repeat ? addDays(today, -OVERDUE_LOOKBACK[e.repeat.every]) : ''
        for (let i = 0; i < (step ? MAX_REPEAT : 1); i++) {
            const date = step ? addMonths(e.date, i * step) : e.date
            if (date > to || (e.repeat?.until && date > e.repeat.until)) break
            const end = span ? addDays(date, span) : undefined
            if ((end ?? date) < from) continue
            const isDone = done.has(date)
            out.push({
                key: `event:${e.id}:${date}`,
                source: 'event',
                id: e.id,
                kind: k.id,
                title: e.title || k.label,
                docPath: e.docPath ?? '',
                date,
                ...(end ? { end } : {}),
                task: k.task,
                done: isDone,
                overdue: k.task && !isDone && (end ?? date) < today && date >= stale,
                repeat: !!step,
                remind: e.remind ?? k.remind,
                ...(e.note ? { note: e.note } : {}),
            })
        }
    }
    return out
}

export function fromEffective(list: { docPath: string; date: string; oid?: string; message?: string; tag?: string }[], kinds: EventKind[]): Occurrence[] {
    const k = kindMap(kinds)(EFFECTIVE_KIND)
    return list.map((e) => ({
        key: `tag:${e.docPath}:${e.date}`,
        source: 'tag' as const,
        id: e.tag ?? `${e.docPath}:${e.date}`,
        kind: EFFECTIVE_KIND,
        title: e.message?.split(/\r?\n/)[0] || `${k.label}`,
        docPath: e.docPath,
        date: e.date,
        task: false,
        done: false,
        overdue: false,
        repeat: false,
        remind: k.remind,
        ...(e.oid ? { oid: e.oid } : {}),
    }))
}

export interface Period {
    key: string
    docPath: string
    date: string
    until: string | null
    title: string
    oid?: string
}

export function effectivePeriods(list: { docPath: string; date: string; oid?: string; message?: string }[]): Period[] {
    const byDoc = new Map<string, typeof list>()
    for (const e of list) {
        if (!isDate(e.date)) continue
        const l = byDoc.get(e.docPath)
        if (l) l.push(e)
        else byDoc.set(e.docPath, [e])
    }
    const out: Period[] = []
    for (const [docPath, l] of byDoc) {
        l.sort((a, b) => a.date.localeCompare(b.date))
        l.forEach((e, i) => {
            const next = l[i + 1]
            out.push({
                key: `${docPath}:${e.date}`,
                docPath,
                date: e.date,
                until: next ? addDays(next.date, -1) : null,
                title: e.message?.split(/\r?\n/)[0] || '',
                ...(e.oid ? { oid: e.oid } : {}),
            })
        })
    }
    return out.sort((a, b) => a.docPath.localeCompare(b.docPath) || a.date.localeCompare(b.date))
}

export function inForceAt<T extends Period>(periods: T[], docPath: string, date: string): T | null {
    let hit: T | null = null
    for (const p of periods) if (p.docPath === docPath && p.date <= date && (!hit || p.date > hit.date)) hit = p
    return hit
}

export function byDate(a: Occurrence, b: Occurrence): number {
    return a.date.localeCompare(b.date) || (b.end ?? b.date).localeCompare(a.end ?? a.date) || a.kind.localeCompare(b.kind)
}

export function dueReminders<T extends Occurrence>(list: T[], today: string): T[] {
    return list.filter((o) => {
        if (o.done || o.remind < 0) return false
        if (o.overdue) return true
        return o.date >= today && dayNum(o.date) - dayNum(today) <= o.remind
    })
}
