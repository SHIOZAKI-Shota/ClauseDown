import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { addMonths, cleanEventInput, cleanKinds, DEFAULT_KINDS, dueReminders, expand, type DueEvent } from '../src/shared/schedule'

const repos: { name: string; dir: string }[] = []
vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos, author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))
const git = await import('../src/main/git')
const sch = await import('../src/main/schedule')

const ev = (p: Partial<DueEvent>): DueEvent => ({
    id: 'x',
    kind: 'submit',
    docPath: '',
    date: '2026-01-31',
    done: [],
    by: '',
    at: '',
    updatedAt: '',
    ...p,
})

describe('日付の計算', () => {
    it('月を足すと、その月に無い日は月末にする', () => {
        expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
        expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
        expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
        expect(addMonths('2028-02-29', 12)).toBe('2029-02-28')
        expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    })
})

describe('期日の展開', () => {
    const K = DEFAULT_KINDS
    it('毎月の繰り返しは月末に丸め、元の日に戻る', () => {
        const occ = expand([ev({ repeat: { every: 'month' } })], K, '2026-01-01', '2026-04-30', '2026-01-01')
        expect(occ.map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    })

    it('毎年の繰り返しは until で止まり、範囲の外は出さない', () => {
        const e = ev({ kind: 'renew', date: '2024-02-29', repeat: { every: 'year', until: '2027-12-31' } })
        expect(expand([e], K, '2025-01-01', '2030-12-31', '2025-01-01').map((o) => o.date)).toEqual(['2025-02-28', '2026-02-28', '2027-02-28'])
    })

    it('期間は範囲に一部でも重なれば出す。済み・期限切れ・消したもの', () => {
        const list = [
            ev({ id: 'a', kind: 'start', date: '2026-01-01', end: '2026-12-31' }),
            ev({ id: 'b', kind: 'submit', date: '2026-03-01' }),
            ev({ id: 'c', kind: 'submit', date: '2026-03-02', done: ['2026-03-02'] }),
            ev({ id: 'd', kind: 'submit', date: '2026-03-03', deleted: true }),
            ev({ id: 'e', kind: 'start', date: '2026-03-04' }),
        ]
        const occ = expand(list, K, '2026-06-01', '2026-06-30', '2026-06-15')
        expect(occ.map((o) => o.id)).toEqual(['a'])
        const all = expand(list, K, '2026-01-01', '2026-12-31', '2026-06-15')
        expect(all.map((o) => [o.id, o.done, o.overdue])).toEqual([
            ['a', false, false],
            ['b', false, true],
            ['c', true, false],
            ['e', false, false],
        ])
        expect(all[0].end).toBe('2026-12-31')
    })

    it('繰り返す期日の古い回は期限切れにしない（毎月は 90 日、毎年は 400 日まで）', () => {
        const list = [
            ev({ id: 'm', kind: 'submit', date: '2026-07-01', repeat: { every: 'month' } }),
            ev({ id: 'y', kind: 'renew', date: '2025-04-01', repeat: { every: 'year' } }),
        ]
        const over = expand(list, K, '2020-01-01', '2026-11-06', '2026-11-06').filter((o) => o.overdue)
        expect(over.map((o) => `${o.id}:${o.date}`)).toEqual(['m:2026-09-01', 'm:2026-10-01', 'm:2026-11-01', 'y:2026-04-01'])
    })

    it('知らせるのは、知らせる日を過ぎて済みでないものと期限切れ', () => {
        const list = [
            ev({ id: 'near', kind: 'submit', date: '2026-11-10' }),
            ev({ id: 'far', kind: 'submit', date: '2026-11-30' }),
            ev({ id: 'over', kind: 'submit', date: '2026-11-01' }),
            ev({ id: 'off', kind: 'submit', date: '2026-11-08', remind: -1 }),
            ev({ id: 'done', kind: 'submit', date: '2026-11-08', done: ['2026-11-08'] }),
        ]
        const occ = expand(list, DEFAULT_KINDS, '2026-01-01', '2027-01-01', '2026-11-06')
        expect(
            dueReminders(occ, '2026-11-06')
                .map((o) => o.id)
                .sort(),
        ).toEqual(['near', 'over'])
    })

    it('入力の確認', () => {
        expect(cleanEventInput({ kind: 'submit', docPath: 'a.md', date: '2026-01-01', end: '2026-01-01', title: '  ' })).toEqual({
            kind: 'submit',
            docPath: 'a.md',
            date: '2026-01-01',
        })
        expect(() => cleanEventInput({ kind: 'submit', docPath: '', date: '2026-02-30x' })).toThrow('日付')
        expect(() => cleanEventInput({ kind: 'submit', docPath: '', date: '2026-02-01', end: '2026-01-01' })).toThrow('終了日')
        expect(() => cleanEventInput({ kind: 'submit', docPath: '../x', date: '2026-02-01' })).toThrow('文書')
        expect(cleanKinds([{ id: 'x', label: '検査', color: 'nope', task: 1, remind: 999 }])).toEqual([
            DEFAULT_KINDS[0],
            { id: 'x', label: '検査', color: 'slate', task: true, remind: 365 },
        ])
    })
})

describe('期日の記録と集計', () => {
    it('足す・直す・済み・消す。施行タグと合わせて一覧にする', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-sch-'))
        await git.initRepo(dir)
        await git.createDoc(dir, '契約書.md', '契約書')
        await git.saveVersion(dir, { message: '初版', effectiveDate: '2026-12-01', docPath: '契約書.md' })

        const a = await sch.saveEvent(dir, { kind: 'renew', docPath: '契約書.md', date: '2026-11-20', repeat: { every: 'year' } })
        expect(a.by).toBe('テスト')
        await sch.setEventDone(dir, a.id, '2026-11-20', true)
        const b = await sch.saveEvent(dir, { kind: 'submit', docPath: '', date: '2026-11-01', title: '届出書' })
        const a2 = await sch.saveEvent(dir, { id: a.id, kind: 'renew', docPath: '契約書.md', date: '2026-11-20', repeat: { every: 'year' }, note: 'メモ' })
        expect(a2).toMatchObject({ id: a.id, done: ['2026-11-20'], note: 'メモ', at: a.at })

        const { items } = await sch.occurrences(dir, '2026-10-01', '2027-12-31', '2026-11-06')
        expect(items.map((o) => [o.source, o.title, o.date, o.done, o.overdue])).toEqual([
            ['event', '届出書', '2026-11-01', false, true],
            ['event', '更新', '2026-11-20', true, false],
            ['tag', '初版', '2026-12-01', false, false],
            ['event', '更新', '2027-11-20', false, false],
        ])

        await sch.deleteEvent(dir, b.id)
        expect((await sch.listEvents(dir)).map((e) => e.id)).toEqual([a.id])
        await expect(sch.setEventDone(dir, b.id, '2026-11-01', true)).rejects.toThrow('見つかりません')

        await expect(
            sch.saveEventKinds(
                dir,
                DEFAULT_KINDS.filter((k) => k.id !== 'renew'),
            ),
        ).rejects.toThrow('更新')
        await sch.saveEventKinds(dir, [...DEFAULT_KINDS, { id: 'k1', label: '検査', color: 'teal', task: true, remind: 3 }])
        expect((await sch.getEventKinds(dir)).at(-1)?.label).toBe('検査')
        expect((await git.listDocs(dir)).map((d) => d.path)).toEqual(['契約書.md'])
    })

    it('全リポジトリの期限切れと今後を、期限切れを先にして集める', async () => {
        const make = async (name: string) => {
            const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-all-'))
            await git.initRepo(dir)
            repos.push({ name, dir })
            return dir
        }
        const a = await make('A社')
        const b = await make('B社')
        repos.push({ name: '消えた', dir: join(os.tmpdir(), 'clausedown-none-xyz') })
        await git.createDoc(a, '規程.md', '規程')
        await git.saveVersion(a, { message: '改定', effectiveDate: '2027-04-01', docPath: '規程.md' })
        await git.saveVersion(a, { message: '前', effectiveDate: '2025-04-01', docPath: '規程.md' }).catch(() => {})
        await sch.saveEvent(a, { kind: 'submit', docPath: '規程.md', date: '2026-10-01' })
        await sch.saveEvent(b, { kind: 'start', docPath: '', date: '2026-12-01' })
        await sch.saveEvent(b, { kind: 'start', docPath: '', date: '2026-01-01' })
        await sch.saveEvent(b, { kind: 'submit', docPath: '', date: '2025-01-10', repeat: { every: 'month' } })

        const list = await sch.scheduleAll('2026-11-06', 120)
        expect(list.map((o) => [o.repo, o.kindLabel, o.date, o.overdue])).toEqual([
            ['B社', '提出', '2026-08-10', true],
            ['B社', '提出', '2026-09-10', true],
            ['A社', '提出', '2026-10-01', true],
            ['B社', '提出', '2026-10-10', true],
            ['B社', '提出', '2026-11-10', false],
            ['B社', '開始', '2026-12-01', false],
            ['B社', '提出', '2026-12-10', false],
            ['B社', '提出', '2027-01-10', false],
            ['B社', '提出', '2027-02-10', false],
        ])
        await expect(sch.scheduleAll('x')).rejects.toThrow()

        const all = await sch.occurrencesAll('2026-11-01', '2027-04-30', '2026-11-06')
        expect(all.repos.map((r) => [r.name, r.docs.map((d) => d.path)])).toEqual([
            ['A社', ['規程.md']],
            ['B社', []],
        ])
        expect(new Set(all.items.map((o) => o.key)).size).toBe(all.items.length)
        expect(all.items.filter((o) => o.repo === 'A社').map((o) => [o.source, o.date])).toEqual([['tag', '2027-04-01']])
        expect(all.items.every((o) => o.key.startsWith(`${o.dir}|`))).toBe(true)

        const icsA = await sch.scheduleIcs(a, '2026-11-06')
        expect(icsA.name).toBe('A社 の期日')
        expect(icsA.text.match(/BEGIN:VEVENT/g)).toHaveLength(icsA.count)
        expect(icsA.text).toContain('SUMMARY:施行')
        const icsAll = await sch.scheduleIcs('', '2026-11-06')
        expect(icsAll.count).toBeGreaterThan(icsA.count)
        await expect(sch.scheduleIcs(join(os.tmpdir(), 'clausedown-none-xyz'), '2026-11-06')).rejects.toThrow('読めませんでした')

        expect(all.repos[0].docs[0].title).toBe('規程')
        await git.writeDoc(a, '規程.md', '# 就業規程\n')
        const later = new Date(Date.now() + 5000)
        fs.utimesSync(join(a, '規程.md'), later, later)
        const again = await sch.occurrencesAll('2026-11-01', '2027-04-30', '2026-11-06')
        expect(again.repos[0].docs[0].title).toBe('就業規程')
    })
})
