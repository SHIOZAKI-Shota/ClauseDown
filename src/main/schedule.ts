import fs from 'node:fs'
import { author } from './git-base'
import { newId, readRecord, readRecords, RECORD, writeRecord } from './records'
import { allEffective } from './repo-home'
import { listDeliveries } from './workflow'
import { listDocTitles } from './git'
import { loadSettings } from './settings'
import {
    addDays,
    byDate,
    cleanEventInput,
    cleanKinds,
    DELIVERY_KIND,
    expand,
    fromEffective,
    isDate,
    kindMap,
    type DueEvent,
    type DueEventInput,
    type EventKind,
    type Occurrence,
    type RepoSchedule,
    type ScheduleItem,
} from '../shared/schedule'
import { exportable, toIcs } from '../shared/ics'

const KINDS_FILE = RECORD.eventKinds
const fileOf = (id: string) => `${RECORD.events}${id}.json`
const isEvent = (e: DueEvent | null): e is DueEvent =>
    !!e && typeof e.id === 'string' && typeof e.kind === 'string' && isDate(e.date) && typeof e.docPath === 'string'

export async function getEventKinds(dir: string): Promise<EventKind[]> {
    return cleanKinds(await readRecord<EventKind[]>(dir, KINDS_FILE))
}

export async function saveEventKinds(dir: string, kinds: EventKind[]): Promise<void> {
    const next = cleanKinds(kinds)
    const used = new Set((await listEvents(dir)).map((e) => e.kind))
    const missing = [...used].filter((k) => !next.some((n) => n.id === k))
    if (missing.length) {
        const names = (await getEventKinds(dir)).filter((k) => missing.includes(k.id)).map((k) => k.label)
        throw new Error(`使用中の種類は削除できません：${names.join('、') || missing.join('、')}`)
    }
    await writeRecord(dir, KINDS_FILE, next)
}

export async function listEvents(dir: string): Promise<DueEvent[]> {
    const all = await readRecords<DueEvent>(dir, RECORD.events)
    return all.filter(isEvent).filter((e) => !e.deleted)
}

async function readEvent(dir: string, id: string): Promise<DueEvent | null> {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('期日の指定が正しくありません')
    const e = await readRecord<DueEvent>(dir, fileOf(id))
    return isEvent(e) && !e.deleted ? e : null
}

export async function saveEvent(dir: string, input: DueEventInput): Promise<DueEvent> {
    const v = cleanEventInput(input)
    const now = new Date().toISOString()
    const prev = v.id ? await readEvent(dir, v.id) : null
    if (v.id && !prev) throw new Error('この期日が見つかりません（ほかの PC で削除された可能性があります）')
    const { id: _id, ...rest } = v
    const event: DueEvent = {
        ...rest,
        id: prev?.id ?? newId(),
        done: (prev?.done ?? []).filter((d) =>
            expand([{ ...rest, id: '', done: [], by: '', at: '', updatedAt: '' }], [], d, d, d).some((o) => o.date === d),
        ),
        by: prev?.by ?? (await author(dir)).name,
        at: prev?.at ?? now,
        updatedAt: now,
    }
    await writeRecord(dir, fileOf(event.id), event)
    return event
}

export async function deleteEvent(dir: string, id: string): Promise<void> {
    const prev = await readEvent(dir, id)
    if (!prev) return
    await writeRecord(dir, fileOf(id), { ...prev, deleted: true, updatedAt: new Date().toISOString() })
}

export async function setEventDone(dir: string, id: string, date: string, done: boolean): Promise<void> {
    if (!isDate(date)) throw new Error('日付が正しくありません')
    const prev = await readEvent(dir, id)
    if (!prev) throw new Error('この期日が見つかりません（ほかの PC で削除された可能性があります）')
    const set = new Set(prev.done ?? [])
    if (done) set.add(date)
    else set.delete(date)
    await writeRecord(dir, fileOf(id), { ...prev, done: [...set].sort(), updatedAt: new Date().toISOString() })
}

const localDate = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function occurrences(
    dir: string,
    from: string,
    to: string,
    today: string,
): Promise<{ kinds: EventKind[]; events: DueEvent[]; items: Occurrence[] }> {
    if (!isDate(from) || !isDate(to) || !isDate(today)) throw new Error('日付が正しくありません')
    const [kinds, events, tags, deliveries] = await Promise.all([
        getEventKinds(dir),
        listEvents(dir),
        allEffective(dir).catch(() => []),
        listDeliveries(dir).catch(() => []),
    ])
    const items = expand(events, kinds, from, to, today)
    items.push(...fromEffective(tags.filter((t) => t.date >= from && t.date <= to), kinds))
    const k = kindMap(kinds)(DELIVERY_KIND)
    for (const d of deliveries) {
        const date = localDate(d.at)
        if (date < from || date > to) continue
        items.push({
            key: `delivery:${d.id}`,
            source: 'delivery',
            id: d.id,
            kind: DELIVERY_KIND,
            title: `${d.title}${d.to ? ` → ${d.to}` : ''}`,
            docPath: d.docPath,
            date,
            task: false,
            done: false,
            overdue: false,
            repeat: false,
            remind: k.remind,
            oid: d.oid,
        })
    }
    return { kinds, events, items: items.sort(byDate) }
}

async function repoPart(r: { dir: string; name: string }, from: string, to: string, today: string) {
    if (!fs.existsSync(r.dir)) return null
    try {
        const [{ kinds, events, items }, docs] = await Promise.all([occurrences(r.dir, from, to, today), listDocTitles(r.dir)])
        const kindOf = kindMap(kinds)
        const repo: RepoSchedule = { dir: r.dir, name: r.name, kinds, events, docs }
        return {
            repo,
            items: items.map((o): ScheduleItem => {
                const k = kindOf(o.kind)
                return { ...o, key: `${r.dir}|${o.key}`, dir: r.dir, repo: r.name, kindLabel: k.label, color: k.color }
            }),
        }
    } catch {
        return null
    }
}

export async function occurrencesAll(from: string, to: string, today: string): Promise<{ repos: RepoSchedule[]; items: ScheduleItem[] }> {
    if (!isDate(from) || !isDate(to) || !isDate(today)) throw new Error('日付が正しくありません')
    const { repos } = await loadSettings()
    const ok = (await Promise.all(repos.map((r) => repoPart(r, from, to, today)))).filter((p) => !!p)
    return { repos: ok.map((p) => p.repo), items: ok.flatMap((p) => p.items).sort(byDate) }
}

export async function scheduleIcs(dir: string, today: string): Promise<{ name: string; text: string; count: number }> {
    if (!isDate(today)) throw new Error('日付が正しくありません')
    const from = addDays(today, -365)
    const to = addDays(today, 365 * 5)
    let items: ScheduleItem[]
    let name = 'ClauseDown の期日'
    if (dir) {
        const r = (await loadSettings()).repos.find((x) => x.dir === dir)
        const part = r ? await repoPart(r, from, to, today) : null
        if (!r || !part) throw new Error('このリポジトリの期日を読めませんでした')
        items = part.items
        name = `${r.name} の期日`
    } else items = (await occurrencesAll(from, to, today)).items
    items = items.filter(exportable)
    return { name, text: toIcs(items, name), count: items.length }
}

export async function scheduleAll(today: string, days = 365): Promise<ScheduleItem[]> {
    if (!isDate(today)) throw new Error('日付が正しくありません')
    const to = addDays(today, Math.max(1, Math.min(3650, Math.trunc(days) || 365)))
    const { repos } = await loadSettings()
    const lists = await Promise.all(
        repos.map(async (r) => {
            if (!fs.existsSync(r.dir)) return []
            try {
                const [kinds, events, tags] = await Promise.all([getEventKinds(r.dir), listEvents(r.dir), allEffective(r.dir)])
                const kindOf = kindMap(kinds)
                const occ = [
                    ...expand(events, kinds, '1900-01-01', to, today),
                    ...fromEffective(tags.filter((t) => t.date >= today && t.date <= to), kinds),
                ].filter((o) => o.overdue || (o.end ?? o.date) >= today)
                return occ.map((o): ScheduleItem => {
                    const k = kindOf(o.kind)
                    return { ...o, dir: r.dir, repo: r.name, kindLabel: k.label, color: k.color }
                })
            } catch {
                return []
            }
        }),
    )
    return lists
        .flat()
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || byDate(a, b) || a.repo.localeCompare(b.repo, 'ja'))
}
