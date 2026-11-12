import { describe, expect, it } from 'vitest'
import { toIcs } from '../src/shared/ics'
import type { ScheduleItem } from '../src/shared/schedule'

const item = (o: Partial<ScheduleItem>): ScheduleItem => ({
    key: 'C:\\仕事\\A社|event:1:2026-12-01',
    source: 'event',
    id: '1',
    kind: 'submit',
    title: '提出',
    docPath: '規程/就業規則.md',
    date: '2026-12-01',
    task: true,
    done: false,
    overdue: false,
    repeat: false,
    remind: 7,
    dir: 'C:\\仕事\\A社',
    repo: 'A社',
    kindLabel: '提出',
    color: 'amber',
    ...o,
})

const unfold = (s: string) => s.replace(/\r\n /g, '')
const events = (s: string) => unfold(s).split('BEGIN:VEVENT').slice(1)

describe('期日の iCalendar', () => {
    it('終日の予定にし、期間の終わりは翌日、知らせる日の 9 時に鳴らす', () => {
        const s = toIcs(
            [item({}), item({ key: 'k2', kind: 'start', kindLabel: '開始', title: '契約期間', date: '2027-01-01', end: '2027-03-31', remind: 0 })],
            'テスト',
        )
        expect(s.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
        expect(s.endsWith('END:VCALENDAR\r\n')).toBe(true)
        const [a, b] = events(s)
        expect(a).toContain('DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261202')
        expect(a).toContain('SUMMARY:提出（A社）')
        expect(a).toContain('DESCRIPTION:リポジトリ：A社\\n文書：就業規則')
        expect(a).toContain('TRIGGER:-PT159H')
        expect(b).toContain('DTEND;VALUE=DATE:20270401')
        expect(b).toContain('SUMMARY:開始：契約期間（A社）')
        expect(b).toContain('TRIGGER:PT9H')
    })

    it('済みの回・納品の記録は出さない。知らせない回には鳴らす設定を付けない', () => {
        const s = toIcs([item({ done: true }), item({ key: 'd', source: 'delivery' }), item({ key: 'n', remind: -1 })], 'テスト')
        const list = events(s)
        expect(list).toHaveLength(1)
        expect(list[0]).not.toContain('VALARM')
    })

    it('記号を逃がし、長い行は 75 バイトで折る。UID はフォルダの場所を含まず、同じ回なら同じ', () => {
        const long = '第一条から第三十条までの改正に伴う届出書類の提出、および関係する官公署への説明の準備；確認'
        const s = toIcs([item({ title: long, note: 'A,B;C\\D\n次の行' })], 'テスト')
        for (const line of s.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
        const [a] = events(s)
        expect(a).toContain(`SUMMARY:提出：${long.replace(';', '\\;')}（A社）`)
        expect(a).toContain('A\\,B\\;C\\\\D\\n次の行')
        const uid = /UID:(\S+)/.exec(a)![1]
        expect(uid).toMatch(/^[0-9a-f]{16}@clausedown$/)
        expect(toIcs([item({})], 'x').match(/UID:\S+/)![0]).toBe(toIcs([item({})], 'y').match(/UID:\S+/)![0])
        expect(toIcs([item({})], 'x').match(/UID:\S+/)![0]).not.toBe(toIcs([item({ key: 'other' })], 'x').match(/UID:\S+/)![0])
    })
})
