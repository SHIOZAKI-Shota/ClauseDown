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

const DOC = '株式会社A/就業規則.md'
const V1 = '# 就業規則\n\n### 目的\n- 初版\n\n### 休日\n- 日曜\n'

describe('draftRef', () => {
    it('Git で使えない文字を置き換える', () => {
        expect(git.draftRef(' 株式会社A 2026年4月改定 ')).toBe('案/株式会社A-2026年4月改定')
        expect(git.draftRef('a/b:c..d')).toBe('案/a-b-c.d')
        expect(() => git.draftRef('  ')).toThrow()
    })
})

describe('改定案', () => {
    const pcA = () => join(root, 'pcA')
    const pcB = () => join(root, 'pcB')
    let draft = ''

    it('現行版を編集中に、変更を引き継いで改定案を作れる', async () => {
        await git.cloneRepo(url, pcA())
        await git.writeDoc(pcA(), DOC, V1)
        await git.saveVersion(pcA(), { message: '初版' })
        await git.push(pcA())

        await git.writeDoc(pcA(), DOC, V1.replace('日曜', '土曜及び日曜'))
        draft = await git.createBranch(pcA(), '株式会社A 2026年4月改定')
        expect(draft).toBe('案/株式会社A-2026年4月改定')
        expect(await git.readDoc(pcA(), DOC)).toContain('土曜及び日曜')
        await git.saveVersion(pcA(), { message: '休日を変更' })

        const branches = await git.listBranches(pcA())
        expect(branches.map((b) => [b.label, b.current, b.changes])).toEqual([
            ['現行版', false, 0],
            ['株式会社A-2026年4月改定', true, 1],
        ])
        await expect(git.createBranch(pcA(), '株式会社A 2026年4月改定')).rejects.toThrow('すでにあります')
    })

    it('案を切り替えると文書の内容も切り替わる。保存していない変更があれば止める', async () => {
        await git.switchBranch(pcA(), 'main')
        expect(await git.readDoc(pcA(), DOC)).toBe(V1)
        await git.writeDoc(pcA(), DOC, 'こわした')
        await expect(git.switchBranch(pcA(), draft)).rejects.toThrow('版を保存していない変更')
        await git.discardChanges(pcA(), DOC)
        await git.switchBranch(pcA(), draft)
        expect(await git.readDoc(pcA(), DOC)).toContain('土曜及び日曜')
    })

    it('案を共有し、別の PC で開ける', async () => {
        expect((await git.sync(pcA())).state).toBe('ahead')
        expect(await git.push(pcA())).toEqual({ state: 'upToDate' })

        await git.cloneRepo(url, pcB())
        const b = (await git.listBranches(pcB())).find((x) => x.name === draft)!
        expect(b).toMatchObject({ local: false, remote: true, changes: 1 })
        await git.switchBranch(pcB(), draft)
        expect(await git.readDoc(pcB(), DOC)).toContain('土曜及び日曜')
    })

    it('現行版が先に別の箇所を変えていたら、自動で両方残して反映し、施行日を付けて案を片付ける', async () => {
        await git.switchBranch(pcB(), 'main')
        await git.writeDoc(pcB(), DOC, V1.replace('初版', '初版（誤字修正）'))
        await git.saveVersion(pcB(), { message: '誤字修正' })
        await git.push(pcB())

        await git.sync(pcA())
        const main = (await git.listBranches(pcA())).find((x) => x.isMain)!
        const d = (await git.listBranches(pcA())).find((x) => x.name === draft)!
        expect(d.mainMoved).toBe(true)
        expect(main.oid).toBe(execFileSync('git', ['-C', join(root, 'docs.git'), 'rev-parse', 'main']).toString().trim())

        const preview = await git.previewMerge(pcA(), draft, 'main')
        expect(preview.upToDate).toBe(false)
        expect(preview.files).toEqual([DOC])
        expect(preview.conflicts).toEqual([])
        expect(preview.autoMerged).toEqual([DOC])

        const state = await git.mergeBranch(pcA(), {
            from: draft,
            into: 'main',
            choices: {},
            message: '改定案を反映',
            effectiveDate: '2026-04-01',
            deleteAfter: true,
        })
        expect(state).toEqual({ state: 'upToDate' })
        const merged = await git.readDoc(pcA(), DOC)
        expect(merged).toContain('土曜及び日曜')
        expect(merged).toContain('初版（誤字修正）')
        expect((await git.listBranches(pcA())).map((x) => x.label)).toEqual(['現行版'])

        const remoteRefs = execFileSync('git', ['-C', join(root, 'docs.git'), 'show-ref']).toString()
        expect(remoteRefs).not.toContain(draft)
        expect(remoteRefs).toContain('施行/株式会社A/就業規則/2026-04-01')
    })

    it('全ての案をまとめた履歴に、案の名前が付く', async () => {
        const draft2 = await git.createBranch(pcA(), '案2')
        await git.writeDoc(pcA(), DOC, V1.replace('日曜', '日曜及び祝日'))
        await git.saveVersion(pcA(), { message: '案2の変更' })
        await git.switchBranch(pcA(), 'main')
        const log = await git.log(pcA(), DOC, true)
        expect(log.find((c) => c.message === '案2の変更')!.branches).toEqual(['案2'])
        expect(log.find((c) => c.message === '改定案を反映')!.branches).toContain('現行版')
        const idx = new Map(log.map((c, i) => [c.oid, i]))
        for (const c of log) for (const p of c.parents) expect(idx.get(p)!).toBeGreaterThan(idx.get(c.oid)!)
        expect((await git.previewMerge(pcA(), 'main', draft2)).upToDate).toBe(true)
    })
})

describe('同じ箇所の重なり', () => {
    it('画面で解決した全文を受け取って反映する。解決していなければ止める', async () => {
        const fsm = await import('node:fs')
        const os = await import('node:os')
        const dir = fsm.mkdtempSync(join(os.tmpdir(), 'cd-conflict-'))
        await git.initRepo(dir)
        await git.writeDoc(dir, 'a.md', '# a\n### 休日\n- 日曜\n### 退職\n- 届出\n')
        await git.saveVersion(dir, { message: 'base' })
        const d = await git.createBranch(dir, 'x')
        await git.writeDoc(dir, 'a.md', '# a\n### 休日\n- 日曜及び祝日\n### 退職\n- 届出\n')
        await git.saveVersion(dir, { message: 'draft' })
        await git.switchBranch(dir, 'main')
        await git.writeDoc(dir, 'a.md', '# a\n### 休日\n- 土曜及び日曜\n### 退職\n- 30日前の届出\n')
        await git.saveVersion(dir, { message: 'main' })

        const p = await git.previewMerge(dir, d, 'main')
        expect(p.conflicts.map((c) => c.path)).toEqual(['a.md'])
        expect(p.conflicts[0]).toMatchObject({ oursDeleted: false, theirsDeleted: false })
        await expect(git.mergeBranch(dir, { from: d, into: 'main', choices: {}, message: 'm' })).rejects.toThrow('解決されていません')

        const resolved = '# a\n### 休日\n- 土曜、日曜及び祝日\n### 退職\n- 30日前の届出\n'
        await git.mergeBranch(dir, { from: d, into: 'main', choices: { 'a.md': { content: resolved } }, message: 'm' })
        expect(await git.readDoc(dir, 'a.md')).toBe(resolved)
    })
})
