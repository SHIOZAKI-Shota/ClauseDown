import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startGitServer } from './git-server'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const iso = (await import('../src/main/igit')).default

let root = ''
let url = ''
let close = () => { }
beforeAll(async () => {
    ; ({ root, url, close } = await startGitServer())
})
afterAll(() => close())

const DOC = '規程.md'
const V1 = '# 規程\n\n### 目的\n- 初版\n'
const gitIn = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args]).toString().trim()

describe('壊れにくさ', () => {
    const pc = () => join(root, 'pc')

    it('取り出しに失敗したら、作ったフォルダを消してやり直せるようにする', async () => {
        const dir = join(root, 'broken')
        await expect(git.cloneRepo(url.replace('docs.git', 'missing.git'), dir)).rejects.toThrow()
        expect(fs.existsSync(dir)).toBe(false)
    })

    it('付け直した施行日を送信できる', async () => {
        await git.cloneRepo(url, pc())
        await git.writeDoc(pc(), DOC, V1)
        const first = await git.saveVersion(pc(), { message: '初版', effectiveDate: '2026-04-01', docPath: DOC })
        expect(await git.push(pc())).toEqual({ state: 'upToDate' })
        await git.writeDoc(pc(), DOC, V1.replace('初版', '改定'))
        const second = await git.saveVersion(pc(), { message: '改定' })
        await git.addEffective(pc(), DOC, second, '2026-04-01')
        expect(await git.push(pc())).toEqual({ state: 'upToDate' })
        const tag = `施行/規程/2026-04-01`
        expect(gitIn(join(root, 'docs.git'), 'rev-parse', `${tag}^{commit}`)).toBe(second)
        expect(second).not.toBe(first)
    })

    it('重なりが解決されていなければ、案も作業フォルダも変えずに止める', async () => {
        const draft = await git.createBranch(pc(), '改定案')
        await git.writeDoc(pc(), DOC, V1.replace('初版', '案の変更'))
        await git.writeDoc(pc(), 'その他.md', '# その他\n')
        await git.saveVersion(pc(), { message: '案' })
        await git.switchBranch(pc(), 'main')
        await git.writeDoc(pc(), DOC, V1.replace('初版', '現行の変更'))
        await git.saveVersion(pc(), { message: '現行' })
        await git.switchBranch(pc(), draft)
        const before = gitIn(pc(), 'rev-parse', 'main')

        await expect(git.mergeBranch(pc(), { from: draft, into: 'main', choices: {}, message: '反映' })).rejects.toThrow('解決されていません')
        expect(await iso.currentBranch({ fs, dir: pc() })).toBe(draft)
        expect(gitIn(pc(), 'rev-parse', 'main')).toBe(before)
        expect((await git.changedPaths(pc())).size).toBe(0)

        await git.mergeBranch(pc(), { from: draft, into: 'main', choices: { [DOC]: { content: V1.replace('初版', '統合') } }, message: '反映' })
        expect(await git.readDoc(pc(), DOC)).toContain('統合')
        expect(await git.readDoc(pc(), 'その他.md')).toBe('# その他\n')
        expect((await git.changedPaths(pc())).size).toBe(0)
        expect(gitIn(pc(), 'show', '--format=%P', '-s', 'HEAD').split(' ')).toHaveLength(2)
    })

    it('ファイル単位の版には、索引に残った別の変更を含めない', async () => {
        fs.writeFileSync(join(pc(), 'その他.md'), '# 書きかけ\n')
        await iso.add({ fs, dir: pc(), filepath: 'その他.md' })
        fs.mkdirSync(join(pc(), 'メモ'), { recursive: true })
        fs.writeFileSync(join(pc(), 'メモ', 'note.md'), '# メモ\n')
        expect(await git.commitFile(pc(), 'メモ/note.md', 'メモを追加')).toBe(true)
        expect(gitIn(pc(), 'show', 'HEAD:その他.md')).toBe('# その他')
        expect(gitIn(pc(), 'show', 'HEAD:メモ/note.md')).toBe('# メモ')
        expect(await git.commitFile(pc(), 'メモ/note.md', 'もう一度')).toBe(false)
    })
})
