import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startGitServer } from './git-server'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')

let root = ''
let url = ''
let close = () => { }
beforeAll(async () => {
    ; ({ root, url, close } = await startGitServer())
})
afterAll(() => close())

describe('2台の PC での同期', () => {
    const pcA = () => join(root, 'pcA')
    const pcB = () => join(root, 'pcB')
    const DOC = '就業規則.md'

    it('空のリモートを取得し、版を保存して送信できる', async () => {
        await git.cloneRepo(url, pcA())
        expect(await git.sync(pcA())).toEqual({ state: 'upToDate' })
        await git.createDoc(pcA(), DOC, '就業規則')
        await git.saveVersion(pcA(), { message: '初版', effectiveDate: '2026-04-01', docPath: DOC })
        expect(await git.sync(pcA())).toEqual({ state: 'ahead', count: 1 })
        expect(await git.push(pcA())).toEqual({ state: 'upToDate' })
        const tags = execFileSync('git', ['-C', join(root, 'docs.git'), 'tag']).toString()
        expect(tags).toContain('就業規則/2026-04-01')
    })

    it('別の PC で取得し、変更を受け取れる（早送り）', async () => {
        await git.cloneRepo(url, pcB())
        expect((await git.listDocs(pcB())).map((d) => d.path)).toEqual([DOC])
        await git.writeDoc(pcB(), DOC, '# 就業規則\n\n### 目的\n- Bの改定\n')
        await git.saveVersion(pcB(), { message: 'B' })
        await git.push(pcB())
        expect(await git.sync(pcA())).toEqual({ state: 'behind' })
        expect(await git.readDoc(pcA(), DOC)).toContain('Bの改定')
    })

    it('保存していない変更があるときは取得しない', async () => {
        await git.writeDoc(pcB(), DOC, '# 就業規則\n\n### 目的\n- B2\n')
        await git.saveVersion(pcB(), { message: 'B2' })
        await git.push(pcB())
        await git.writeDoc(pcA(), DOC, '# 就業規則\n\n### 目的\n- 編集中\n')
        expect(await git.sync(pcA())).toEqual({ state: 'dirty' })
        await git.discardChanges(pcA(), DOC)
        expect(await git.sync(pcA())).toEqual({ state: 'behind' })
    })

    it('両方が同じ文書を変えたら重なりを検出し、選んだ版で統合して送信する', async () => {
        await git.writeDoc(pcA(), DOC, '# 就業規則\n\n### 目的\n- Aの改定\n')
        await git.saveVersion(pcA(), { message: 'A' })
        await git.writeDoc(pcB(), DOC, '# 就業規則\n\n### 目的\n- Bの再改定\n')
        await git.saveVersion(pcB(), { message: 'B3' })
        await git.push(pcB())

        const s = await git.sync(pcA())
        expect(s.state).toBe('diverged')
        if (s.state !== 'diverged') return
        expect(s.conflicts.map((c) => c.path)).toEqual([DOC])
        expect(s.conflicts[0].ours).toContain('Aの改定')
        expect(s.conflicts[0].theirs).toContain('Bの再改定')

        expect(await git.resolveConflicts(pcA(), s.theirs, { [DOC]: 'ours' })).toEqual({ state: 'upToDate' })
        expect(await git.sync(pcB())).toEqual({ state: 'behind' })
        expect(await git.readDoc(pcB(), DOC)).toContain('Aの改定')
    })
})
