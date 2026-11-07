import { describe, expect, it, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import isogit from 'isomorphic-git'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const who = { name: '相手', email: 'b@example.com' }

describe('git ラッパー（ローカル）', () => {
    let dir: string
    beforeAll(async () => {
        dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-'))
        await git.initRepo(dir)
    })

    it('文書の作成・版の保存・履歴・過去版の読み出し', async () => {
        await git.createDoc(dir, '規程/就業規則.md', '就業規則')
        let docs = await git.listDocs(dir)
        expect(docs).toEqual([{ path: '規程/就業規則.md', title: '就業規則', changed: true }])

        const v1 = await git.saveVersion(dir, { message: '初版', effectiveDate: '2026-04-01', docPath: '規程/就業規則.md' })
        docs = await git.listDocs(dir)
        expect(docs[0].changed).toBe(false)
        await expect(git.saveVersion(dir, { message: 'x' })).rejects.toThrow('変更がありません')

        await git.writeDoc(dir, '規程/就業規則.md', '# 就業規則\n\n### 目的\n- 改定\n')
        const v2 = await git.saveVersion(dir, { message: '第1条を改定' })
        const log = await git.log(dir, '規程/就業規則.md')
        expect(log.map((c) => c.oid)).toEqual([v2, v1])
        expect(log[1].tags).toEqual(['施行/規程/就業規則/2026-04-01'])
        expect(log[1].message).toContain('施行日: 2026-04-01')
        expect(await git.readAt(dir, v1, '規程/就業規則.md')).toContain('### 目的\n- \n')
    })

    it('変更の取り消し', async () => {
        await git.writeDoc(dir, '規程/就業規則.md', 'こわした')
        await git.discardChanges(dir, '規程/就業規則.md')
        expect(await git.readDoc(dir, '規程/就業規則.md')).toContain('改定')
        await git.createDoc(dir, 'new.md', '新規')
        await git.discardChanges(dir, 'new.md')
        expect(fs.existsSync(join(dir, 'new.md'))).toBe(false)
    })

    it('リポジトリ外のパスは拒否する', async () => {
        await expect(git.writeDoc(dir, '../evil.md', 'x')).rejects.toThrow('不正なパス')
    })

    it('分岐した履歴を、選んだ版で統合する', async () => {
        const base = await isogit.resolveRef({ fs, dir, ref: 'HEAD' })
        await isogit.branch({ fs, dir, ref: 'theirs', object: base })
        await isogit.checkout({ fs, dir, ref: 'theirs' })
        fs.writeFileSync(join(dir, '規程/就業規則.md'), '# 就業規則\n\n### 目的\n- 相手の改定\n')
        fs.writeFileSync(join(dir, 'a.md'), '# A\n')
        await isogit.add({ fs, dir, filepath: '規程/就業規則.md' })
        await isogit.add({ fs, dir, filepath: 'a.md' })
        const theirs = await isogit.commit({ fs, dir, message: '相手', author: who })
        await isogit.checkout({ fs, dir, ref: 'main', force: true })
        await git.writeDoc(dir, '規程/就業規則.md', '# 就業規則\n\n### 目的\n- 自分の改定\n')
        await git.saveVersion(dir, { message: '自分' })

        const r = await git.resolveConflicts(dir, theirs, { '規程/就業規則.md': 'theirs' })
        expect(r).toEqual({ state: 'local' })
        expect(await git.readDoc(dir, '規程/就業規則.md')).toContain('相手の改定')
        expect(await git.readDoc(dir, 'a.md')).toBe('# A\n')
        const [merge] = await git.log(dir)
        expect(merge.parents.length).toBe(2)
        expect((await git.listDocs(dir)).every((d) => !d.changed)).toBe(true)
    })
})

describe('改行コード', () => {
    it('CRLF に変わっただけのファイルは、保存していない変更として数えない', async () => {
        const d = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-eol-'))
        await git.initRepo(d)
        await git.writeDoc(d, 'a.md', '# a\n### 目的\n- 本文\n')
        await git.saveVersion(d, { message: 'base' })
        fs.writeFileSync(join(d, 'a.md'), '# a\r\n### 目的\r\n- 本文\r\n')
        expect((await git.listDocs(d))[0].changed).toBe(false)
        await expect(git.saveVersion(d, { message: 'x' })).rejects.toThrow('変更がありません')
        await git.createBranch(d, 'x')
        await git.switchBranch(d, 'main')
        fs.writeFileSync(join(d, 'a.md'), '# a\r\n### 目的\r\n- 本文を直した\r\n')
        expect((await git.listDocs(d))[0].changed).toBe(true)
    })
})
