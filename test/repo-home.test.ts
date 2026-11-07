import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const home = await import('../src/main/repo-home')

describe('リポジトリホームの情報', () => {
    it('最近の版・文書ごとの最終更新と条数・施行日', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-home-'))
        await git.initRepo(dir)
        await git.createDoc(dir, '規程/就業規則.md', '就業規則')
        await git.createDoc(dir, '賃金規程.md', '賃金規程')
        const v1 = await git.saveVersion(dir, { message: '初版', effectiveDate: '2026-04-01', docPath: '規程/就業規則.md' })
        await git.writeDoc(dir, '規程/就業規則.md', '# 就業規則\n\n## 総則\n\n### 目的\n- a\n\n### 定義\n- b\n')
        const v2 = await git.saveVersion(dir, { message: '第2条を追加' })
        await git.createDoc(dir, '未保存.md', '未保存')

        const a = await home.repoActivity(dir)
        expect(a.recent.map((r) => [r.oid, r.message, r.paths])).toEqual([
            [v2, '第2条を追加', ['規程/就業規則.md']],
            [v1, '初版', ['規程/就業規則.md', '賃金規程.md']],
        ])
        expect(a.docs['規程/就業規則.md']).toMatchObject({ articles: 2, author: 'テスト' })
        expect(a.docs['賃金規程.md'].timestamp).toBeGreaterThan(0)
        expect(a.docs['未保存.md']).toEqual({ articles: 1 })
        expect(a.effective).toEqual([{ docPath: '規程/就業規則.md', date: '2026-04-01', oid: v1, message: '初版' }])
    })

    it('説明は版として記録し、文書の一覧には出さない', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-note-'))
        await git.initRepo(dir)
        expect(await home.readRepoNote(dir)).toBe('')
        expect(await home.saveRepoNote(dir, '株式会社A様の規程一式')).toBe(true)
        expect(await home.readRepoNote(dir)).toBe('株式会社A様の規程一式\n')
        expect(await home.saveRepoNote(dir, '株式会社A様の規程一式')).toBe(false)
        expect(await git.listDocs(dir)).toEqual([])
        expect((await git.log(dir))[0].message).toBe('リポジトリの説明を更新')
        expect(await home.saveRepoNote(dir, '  ')).toBe(true)
        expect(await home.readRepoNote(dir)).toBe('')
    })
})
