import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import igit from 'isomorphic-git'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')

async function repo() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-eff-'))
    await git.initRepo(dir)
    await git.createDoc(dir, '規程/就業規則.md', '就業規則')
    await git.createDoc(dir, '賃金規程.md', '賃金規程')
    return dir
}

describe('施行日のタグ', () => {
    it('文書ごとに読み分け、版の説明から施行日の行を外す', async () => {
        const dir = await repo()
        const v1 = await git.saveVersion(dir, { message: '初版', effectiveDate: '2026-04-01', docPath: '規程/就業規則.md' })
        await git.addEffective(dir, '賃金規程.md', v1, '2026-05-01')
        const all = await git.effectiveTags(dir)
        expect(all.map((e) => [e.path, e.date, e.oid, e.message])).toEqual([
            ['賃金規程', '2026-05-01', v1, '初版'],
            ['規程/就業規則', '2026-04-01', v1, '初版'],
        ])
        expect((await git.listEffective(dir, '規程/就業規則.md')).map((e) => e.date)).toEqual(['2026-04-01'])
        expect(await git.listEffective(dir, 'ない.md')).toEqual([])
    })

    it('存在しない日付は記録せず、手で作られた不正なタグも読み飛ばす', async () => {
        const dir = await repo()
        const v1 = await git.saveVersion(dir, { message: '初版' })
        await expect(git.addEffective(dir, '賃金規程.md', v1, '2026-02-31')).rejects.toThrow()
        await igit.tag({ fs, dir, ref: '施行/賃金規程/2026-13-01', object: v1 })
        await igit.tag({ fs, dir, ref: '施行/2026-04-01', object: v1 })
        expect(await git.effectiveTags(dir)).toEqual([])
    })
})

describe('版のあいだで変わった文書', () => {
    it('変わったフォルダだけをたどり、.md 以外と隠しフォルダは数えない', async () => {
        const dir = await repo()
        const v1 = await git.saveVersion(dir, { message: '初版' })
        await git.writeDoc(dir, '規程/就業規則.md', '# 就業規則\n\n### 目的\n- 変更\n')
        fs.writeFileSync(join(dir, 'メモ.txt'), 'x')
        const v2 = await git.saveVersion(dir, { message: '変更' })
        const tree = async (oid: string) => (await igit.readCommit({ fs, dir, oid })).commit.tree
        expect(await git.changedDocs(dir, await tree(v2), await tree(v1))).toEqual(['規程/就業規則.md'])
        expect((await git.changedDocs(dir, await tree(v1), null)).sort()).toEqual(['規程/就業規則.md', '賃金規程.md'])
        expect(await git.changedDocs(dir, await tree(v1), await tree(v1))).toEqual([])
    })
})
