import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const ops = await import('../src/main/doc-ops')

async function newRepo() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-ops-'))
    await git.initRepo(dir)
    return dir
}

describe('文書のファイル操作', () => {
    let dir: string
    beforeEach(async () => {
        dir = await newRepo()
        await git.createDoc(dir, '規程/就業規則.md', '就業規則')
        await git.createDoc(dir, 'その他.md', 'その他')
        await git.saveVersion(dir, { message: '初版' })
    })

    it('移動すると版として記録し、ほかの保存していない変更は残す', async () => {
        await git.writeDoc(dir, 'その他.md', '# その他\n\n### 目的\n- 書きかけ\n')
        const r = await ops.moveDoc(dir, '規程/就業規則.md', '人事')
        expect(r).toEqual({ path: '人事/就業規則.md', recorded: true })
        const docs = await git.listDocs(dir)
        expect(docs.map((d) => [d.path, d.changed])).toEqual([
            ['その他.md', true],
            ['人事/就業規則.md', false],
        ])
        const [last] = await git.log(dir)
        expect(last.message).toContain('「就業規則」を移動（規程/就業規則.md → 人事/就業規則.md）')
    })

    it('直下へも移せる。同じ名前があれば移さない', async () => {
        expect((await ops.moveDoc(dir, '規程/就業規則.md', '')).path).toBe('就業規則.md')
        await git.createDoc(dir, '規程/その他.md', 'その他')
        await expect(ops.moveDoc(dir, '規程/その他.md', '')).rejects.toThrow('同じ名前')
    })

    it('保存していない変更がある文書は移さない', async () => {
        await git.writeDoc(dir, '規程/就業規則.md', '# 就業規則\n変更\n')
        await expect(ops.moveDoc(dir, '規程/就業規則.md', '人事')).rejects.toThrow('版を保存')
        expect(fs.existsSync(join(dir, '規程/就業規則.md'))).toBe(true)
    })

    it('まだ保存していない文書は、ファイルを動かすだけ', async () => {
        await git.createDoc(dir, '新規.md', '新規')
        const before = (await git.log(dir)).length
        expect(await ops.moveDoc(dir, '新規.md', '規程')).toEqual({ path: '規程/新規.md', recorded: false })
        expect((await git.log(dir)).length).toBe(before)
    })

    it('上の階層や隠しフォルダへは移さない', async () => {
        await expect(ops.moveDoc(dir, 'その他.md', '../外')).rejects.toThrow('使えないディレクトリ名')
        await expect(ops.moveDoc(dir, 'その他.md', '.git')).rejects.toThrow('使えないディレクトリ名')
    })

    it('コピーは「（コピー）」を付け、名前にも付ける。続けてコピーすると番号を付ける', async () => {
        expect(await ops.copyDoc(dir, '規程/就業規則.md')).toBe('規程/就業規則（コピー）.md')
        expect(await ops.copyDoc(dir, '規程/就業規則.md')).toBe('規程/就業規則（コピー 2）.md')
        expect(await git.readDoc(dir, '規程/就業規則（コピー）.md')).toMatch(/^# 就業規則（コピー）$/m)
    })

    it('別のリポジトリの同じ場所へコピーする（あれば「（コピー）」を付ける）', async () => {
        const other = await newRepo()
        expect(await ops.copyDocToRepo(dir, '規程/就業規則.md', other)).toBe('規程/就業規則.md')
        expect(await ops.copyDocToRepo(dir, '規程/就業規則.md', other)).toBe('規程/就業規則（コピー）.md')
        expect(await git.readDoc(other, '規程/就業規則.md')).toContain('# 就業規則')
        await expect(ops.copyDocToRepo(dir, 'その他.md', os.tmpdir())).rejects.toThrow('リポジトリではありません')
    })

    it('削除すると版として記録し、前の版からは読める', async () => {
        const [v1] = await git.log(dir)
        expect(await ops.deleteDoc(dir, 'その他.md')).toEqual({ recorded: true })
        expect((await git.listDocs(dir)).map((d) => d.path)).toEqual(['規程/就業規則.md'])
        expect((await git.log(dir))[0].message).toBe('「その他」を削除')
        expect(await git.readAt(dir, v1.oid, 'その他.md')).toContain('# その他')
    })

    it('文書でないものは扱わない', async () => {
        await expect(ops.deleteDoc(dir, '.git/config')).rejects.toThrow('文書（.md）')
        await expect(ops.copyDoc(dir, '../x.md')).rejects.toThrow()
    })
})
