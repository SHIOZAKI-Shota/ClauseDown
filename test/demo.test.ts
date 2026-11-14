import { describe, expect, it } from 'vitest'
import { seed } from '../src/renderer/demo/seed'
import { createDemoApi } from '../src/renderer/demo/api'
import { MAIN } from '../src/renderer/demo/state'

const today = new Date().toISOString().slice(0, 10)

describe('公式サイトのデモの初期データ', () => {
    it('文書の種類ごとにリポジトリを分け、セクションでまとめる', () => {
        const s = seed()
        expect(s.repos).toHaveLength(5)
        for (const r of s.repos) expect(Object.keys(r.commits[r.branches[MAIN]].files)).toHaveLength(1)
        expect(new Set(s.settings.repos.map((r) => r.section))).toEqual(new Set(['見本株式会社', '見本出版株式会社', '見本市']))
    })

    it('どのリポジトリも改定の履歴・施行日・課題・期日を持つ', () => {
        for (const r of seed().repos) {
            expect(Object.keys(r.commits).length).toBeGreaterThanOrEqual(2)
            expect(Object.keys(r.tags).length).toBeGreaterThanOrEqual(1)
            expect(r.issues.length).toBeGreaterThanOrEqual(1)
            expect(r.events.length).toBeGreaterThanOrEqual(2)
        }
    })
})

describe('公式サイトのデモの API', () => {
    const api = createDemoApi()
    const dir = '/demo/mihon-shugyo'

    it('改定案の一覧：現行版が先に進んだ改定案が分かる', async () => {
        const branches = await api.listBranches(dir)
        expect(branches[0]).toMatchObject({ isMain: true, label: '現行版', current: true })
        expect(branches.find((b) => b.label === '副業・兼業の届出制')).toMatchObject({ mainMoved: true, changes: 1 })
        expect(branches.find((b) => b.label === 'カスタマーハラスメント対策')).toMatchObject({ mainMoved: false, changes: 2 })
    })

    it('改定履歴：文書を変えた版だけを新しい順に並べ、施行日のタグが付く', async () => {
        const log = await api.log(dir, '就業規則.md', true)
        expect(log.length).toBeGreaterThanOrEqual(6)
        expect(log.filter((c) => c.tags.length).length).toBe(4)
        expect(log.find((c) => c.head)?.message).toContain('病気休暇')
    })

    it('期日：期限切れとこれからの期日、施行日がまとめて出る', async () => {
        const items = await api.scheduleAll(today, 365)
        expect(items.some((i) => i.overdue)).toBe(true)
        expect(items.some((i) => i.source === 'tag')).toBe(true)
        expect(new Set(items.map((i) => i.dir)).size).toBeGreaterThanOrEqual(4)
    })

    it('改定案を現行版に反映すると、Closes の課題が閉じる', async () => {
        const from = (await api.listBranches(dir)).find((b) => b.label === 'カスタマーハラスメント対策')!.name
        const preview = await api.previewMerge(dir, from, MAIN)
        expect(preview.conflicts).toEqual([])
        await api.mergeBranch(dir, { from, into: MAIN, choices: {}, message: 'カスハラ対策を反映\n\nCloses #2', deleteAfter: true })
        expect((await api.listIssues(dir)).find((i) => i.n === 2)?.state).toBe('closed')
        expect(await api.readDoc(dir, '就業規則.md')).toContain('カスタマーハラスメント')
    })

    it('用意していない操作は、デモでは使えないと伝える', async () => {
        await expect(api.sync(dir).then(() => api.cloneRepo('x', 'y'))).rejects.toThrow('デモでは使えません')
    })
})
