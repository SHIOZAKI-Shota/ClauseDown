import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startGitServer } from './git-server'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const records = await import('../src/main/records')
const isogit = (await import('isomorphic-git')).default

let root = ''
let base = ''
let close = () => {}
beforeAll(async () => {
    let url = ''
    ;({ root, url, close } = await startGitServer())
    base = url.replace(/docs\.git$/, '')
})
afterAll(() => close())

function bare(name: string) {
    const p = join(root, name)
    execFileSync('git', ['init', '--bare', '-b', 'main', p])
    execFileSync('git', ['-C', p, 'config', 'http.receivepack', 'true'])
    return base + name
}
const out = (args: string[]) => execFileSync('git', args).toString()

describe('GitHub で共有を始める', () => {
    const local = () => join(root, 'local')
    const DOC = '就業規則.md'

    it('現行版・改定案・施行日の印をまとめて送り、別の PC で取得できる', async () => {
        await git.initRepo(local())
        await git.createDoc(local(), DOC, '就業規則')
        await git.saveVersion(local(), { message: '初版', effectiveDate: '2026-04-01', docPath: DOC })
        const draft = await git.createBranch(local(), '夏季休暇')
        const url = bare('pub.git')

        expect(await git.publishRepo(local(), url)).toBe(url)
        const srv = join(root, 'pub.git')
        expect(out(['-C', srv, 'branch'])).toContain('main')
        expect(out(['-C', srv, 'branch'])).toContain(draft)
        expect(out(['-C', srv, 'tag'])).toContain('就業規則/2026-04-01')
        expect(await git.sync(local())).toEqual({ state: 'upToDate' })

        await git.cloneRepo(url, join(root, 'other'))
        expect((await git.listDocs(join(root, 'other'))).map((d) => d.path)).toEqual([DOC])
    })

    it('現行版を最初に、記録用の枝を最後に送る（GitHub・GitLab は最初に届いた枝を既定の枝にするため）', async () => {
        const dir = join(root, 'order')
        await git.initRepo(dir)
        await git.createDoc(dir, DOC, '就業規則')
        await git.saveVersion(dir, { message: '初版', docPath: DOC })
        await git.createBranch(dir, 'あ')
        await records.writeRecord(dir, records.RECORD.rules, { requireApproval: false, approvers: [] })
        const spy = vi.spyOn(isogit, 'push')
        try {
            await git.publishRepo(dir, bare('order.git'))
            const branches = spy.mock.calls.map(([o]) => String(o.ref)).filter((r) => !r.startsWith('refs/tags/'))
            expect(branches[0]).toBe('main')
            expect(branches.at(-1)).toBe('clausedown-records')
        } finally {
            spy.mockRestore()
        }
    })

    it('すでにリモートがあるリポジトリでは使えない', async () => {
        await expect(git.publishRepo(local(), bare('pub2.git'))).rejects.toThrow('すでにリモート')
    })

    it('中身のあるリモートには送らず、リモートの設定も残さない', async () => {
        const dir = join(root, 'local2')
        await git.initRepo(dir)
        await git.createDoc(dir, DOC, '就業規則')
        await git.saveVersion(dir, { message: '初版' })
        await expect(git.publishRepo(dir, base + 'pub.git')).rejects.toThrow('空ではありません')
        expect(await git.sync(dir)).toEqual({ state: 'local' })
    })

    it('版がひとつもなければ送らない・http の外部サーバーは受け付けない', async () => {
        const dir = join(root, 'empty')
        await git.initRepo(dir)
        await expect(git.publishRepo(dir, bare('pub3.git'))).rejects.toThrow('版が保存されていません')
        await expect(git.publishRepo(dir, 'http://example.com/x.git')).rejects.toThrow('https://')
    })
})

describe('リモートの変更・リモートから外す', () => {
    const DOC = '就業規則.md'
    const dir = () => join(root, 'move')

    it('同じ履歴を持つリモート・空のリモートには移れ、別の履歴のリモートには移れない', async () => {
        await git.initRepo(dir())
        await git.createDoc(dir(), DOC, '就業規則')
        await git.saveVersion(dir(), { message: '初版' })
        const first = bare('mv1.git')
        await git.publishRepo(dir(), first)

        const empty = bare('mv2.git')
        expect(await git.changeRemote(dir(), empty)).toBe(empty)
        expect(out(['-C', join(root, 'mv2.git'), 'branch'])).toContain('main')
        expect(await git.sync(dir())).toEqual({ state: 'upToDate' })

        expect(await git.changeRemote(dir(), first)).toBe(first)

        await expect(git.changeRemote(dir(), base + 'pub.git')).rejects.toThrow('別の履歴')
        expect(out(['-C', dir(), 'remote', 'get-url', 'origin']).trim()).toBe(first)
    })

    it('リモートから外すとローカルに戻り、もう一度共有を始められる', async () => {
        await git.disconnectRemote(dir())
        expect(await git.sync(dir())).toEqual({ state: 'local' })
        expect(out(['-C', dir(), 'branch', '-r']).trim()).toBe('')
        const again = bare('mv3.git')
        expect(await git.publishRepo(dir(), again)).toBe(again)
    })
})

describe('リポジトリを新しく作る・取得する場所', () => {
    it('ファイルの入ったフォルダには作らない（空のフォルダ・まだないフォルダには作れる）', async () => {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const full = join(root, 'has-files')
        mkdirSync(full)
        writeFileSync(join(full, 'memo.txt'), 'x')
        await expect(git.initRepo(full)).rejects.toThrow('すでにあり')
        await expect(git.cloneRepo(base + 'pub.git', full)).rejects.toThrow('すでにあり')
        const empty = join(root, 'empty-dir')
        mkdirSync(empty)
        await git.initRepo(empty)
        await git.initRepo(join(root, 'new-dir'))
        await expect(git.initRepo(empty)).rejects.toThrow('すでに版管理')
    })
})
