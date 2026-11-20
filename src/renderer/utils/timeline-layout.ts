import { dayNum, fromDayNum } from '@shared/schedule'

export interface Tick {
    x: number
    w: number
    label: string
    key: string
    weekend?: boolean
    strong?: boolean
}

export interface AxisLabels {
    monthLabel: (year: number, month: number) => string
    yearLabel: (year: number) => string
    monthShort: (month: number) => string
}

export function monthStarts(fromN: number, toN: number): number[] {
    const d = fromDayNum(Math.floor(fromN))
    let [y, m] = d.split('-').map(Number)
    const out: number[] = []
    for (let i = 0; i < 400; i++) {
        const n = dayNum(`${y}-${String(m).padStart(2, '0')}-01`)
        if (n > toN) break
        out.push(n)
        m++
        if (m > 12) {
            m = 1
            y++
        }
    }
    return out
}

export function buildAxis(left: number, days: number, ppd: number, s: AxisLabels) {
    const xOf = (n: number) => (n - left) * ppd
    const a = Math.floor(left) - 1
    const b = Math.ceil(left + days) + 1
    const major: Tick[] = []
    const minor: Tick[] = []
    const lines: Tick[] = []
    const months = monthStarts(a - 31, b + 31)
    if (ppd >= 14) {
        for (let i = 0; i < months.length - 1; i++) {
            const d = fromDayNum(months[i])
            major.push({ x: xOf(months[i]), w: (months[i + 1] - months[i]) * ppd, label: s.monthLabel(Number(d.slice(0, 4)), Number(d.slice(5, 7))), key: d })
        }
        for (let n = a; n <= b; n++) {
            const wd = new Date(n * 86400000).getUTCDay()
            const d = fromDayNum(n)
            minor.push({ x: xOf(n), w: ppd, label: String(Number(d.slice(8))), key: d, weekend: wd === 0 || wd === 6, strong: d.endsWith('-01') })
        }
        lines.push(...minor)
    } else {
        const years = months.filter((n) => fromDayNum(n).endsWith('-01-01'))
        const ys = [months[0], ...years.filter((n) => n !== months[0])]
        for (let i = 0; i < ys.length; i++) {
            const end = ys[i + 1] ?? months[months.length - 1]
            major.push({ x: xOf(ys[i]), w: (end - ys[i]) * ppd, label: s.yearLabel(Number(fromDayNum(ys[i]).slice(0, 4))), key: `y${ys[i]}` })
        }
        const monthW = 30 * ppd
        for (let i = 0; i < months.length - 1; i++) {
            const d = fromDayNum(months[i])
            const mo = Number(d.slice(5, 7))
            const label = monthW >= 26 ? s.monthShort(mo) : monthW >= 9 && (mo - 1) % 3 === 0 ? `${mo}` : ''
            minor.push({ x: xOf(months[i]), w: (months[i + 1] - months[i]) * ppd, label, key: d, strong: mo === 1 })
        }
        lines.push(...minor.filter((t) => monthW >= 6 || t.strong))
    }
    const majorLabels = major
        .map((t) => ({ key: t.key, label: t.label, x: Math.max(t.x, 0) + 6, room: t.x + t.w - Math.max(t.x, 0) }))
        .filter((l) => l.room > l.label.length * 12 + 8)
    return { major, minor, lines, majorLabels }
}

export function packLanes<T extends { x: number; w: number; lane: number }>(list: T[], gap = 4): number {
    list.sort((a, b) => a.x - b.x || b.w - a.w)
    const ends: number[] = []
    for (const pl of list) {
        let lane = ends.findIndex((e) => e <= pl.x - gap)
        if (lane === -1) lane = ends.length
        ends[lane] = pl.x + pl.w
        pl.lane = lane
    }
    return ends.length
}
