import { app, Notification } from 'electron'
import { t } from '../shared/i18n'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { dueReminders, type ScheduleItem } from '../shared/schedule'
import type { OpenScheduleEvent } from '../shared/api'
import { scheduleAll } from './schedule'
import { loadSettings } from './settings'

const HOUR = 60 * 60 * 1000
const notifiedPath = () => join(app.getPath('userData'), 'notified.json')

const keyOf = (o: ScheduleItem) => `${o.dir}|${o.key}${o.overdue ? '|overdue' : ''}`

async function readNotified(): Promise<Record<string, string>> {
    try {
        return JSON.parse(await fsp.readFile(notifiedPath(), 'utf8'))
    } catch {
        return {}
    }
}

const p = (n: number) => String(n).padStart(2, '0')
const localToday = () => {
    const d = new Date()
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function bodyOf(o: ScheduleItem, today: string): string {
    const days = Math.round((Date.parse(o.date) - Date.parse(today)) / 86400000)
    const r = t().notify.reminder
    const when = o.overdue ? r.overdue : days === 0 ? r.today : days === 1 ? r.tomorrow : r.inDays(days, o.date)
    const doc = o.docPath ? o.docPath.replace(/\.md$/i, '').split('/').pop() : r.wholeRepo
    return `${o.repo}・${doc}\n${when}`
}

export async function checkReminders(open: (e: OpenScheduleEvent) => void): Promise<void> {
    const { prefs } = await loadSettings()
    if (prefs.notifyDue === false || !Notification.isSupported()) return
    const today = localToday()
    const due = dueReminders(await scheduleAll(today, 365), today)
    if (!due.length) return
    const notified = await readNotified()
    const limit = new Date(Date.now() - 365 * 24 * HOUR).toISOString()
    for (const [k, at] of Object.entries(notified)) if (at < limit) delete notified[k]
    const fresh = due.filter((o) => !notified[keyOf(o)])
    const shown = fresh.length > 3 ? [] : fresh
    for (const o of shown) {
        const n = new Notification({ title: t().notify.reminder.title(o.kindLabel, o.title), body: bodyOf(o, today) })
        n.on('click', () => open({ dir: o.dir, docPath: o.docPath }))
        n.show()
    }
    if (fresh.length > 3) {
        const overdue = fresh.filter((o) => o.overdue).length
        const n = new Notification({
            title: t().notify.reminder.many(fresh.length),
            body: overdue
                ? t().notify.reminder.manyOverdue(overdue)
                : fresh
                      .slice(0, 3)
                      .map((o) => `${o.date} ${o.title}`)
                      .join('\n'),
        })
        n.on('click', () => open({ dir: new Set(fresh.map((o) => o.dir)).size > 1 ? '' : fresh[0].dir, docPath: '' }))
        n.show()
    }
    const now = new Date().toISOString()
    for (const o of fresh) notified[keyOf(o)] = now
    await fsp.writeFile(notifiedPath(), JSON.stringify(notified), 'utf8').catch(() => {})
}

export function startReminders(open: (e: OpenScheduleEvent) => void): void {
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'com.clausedown.app' : process.execPath)
    const tick = () => void checkReminders(open).catch((e) => console.error('[reminder]', e))
    setTimeout(tick, 15_000)
    setInterval(tick, HOUR)
}
