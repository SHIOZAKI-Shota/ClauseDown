import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const igit = (await import('../src/main/igit')).default
const sch = await import('../src/main/schedule')
const wf = await import('../src/main/workflow')
const { createSamples } = await import('../src/main/samples')
const { duplicateRepo } = await import('../src/main/repo-copy')
const { detectHouritsu } = await import('../src/main/houritsu')

describe('サンプルリポジトリ', () => {
    it('4 つのリポジトリを、版・改定案・施行日・期日・確認の依頼付きで作る', async () => {
        const parent = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-samples-'))
        const made = await createSamples(parent)
        expect(made.map((m) => m.name)).toEqual(['SAMPLE_見本株式会社_社内規程', 'SAMPLE_見本_契約書', 'SAMPLE_見本市_条例・要綱', 'SAMPLE_houritsu_法令'])

        const rules = made[0].dir
        expect((await git.listDocs(rules)).map((d) => [d.path, d.changed])).toEqual([['就業規則.md', false]])
        expect((await git.log(rules)).map((c) => c.message.split('\n')[0])).toEqual([
            '不妊治療休暇の日数と通勤手当の上限を引上げ',
            '厚生労働省のモデル就業規則をもとに作成',
        ])
        expect(await igit.listTags({ fs, dir: rules })).toEqual(['施行/就業規則/2025-04-01', '施行/就業規則/2026-04-01'])
        expect(await igit.listBranches({ fs, dir: rules })).toContain('案/2027年4月改定')
        expect((await sch.listEvents(rules)).length).toBe(5)
        expect((await wf.listReviews(rules)).length).toBe(1)
        expect(await detectHouritsu(made[3].dir)).toHaveLength(3)

        const again = await createSamples(parent)
        expect(again[0].name).toBe('SAMPLE_見本株式会社_社内規程（2）')
    })

    it('複製すると履歴ごとコピーし、リモートを外す', async () => {
        const parent = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-dup-'))
        const [src] = await createSamples(parent)
        await igit.addRemote({ fs, dir: src.dir, remote: 'origin', url: 'https://github.com/example/rules.git' })
        await igit.addRemote({ fs, dir: src.dir, remote: 'upstream', url: 'https://github.com/other/rules.git' })
        const dest = await duplicateRepo(src.dir, parent, '別会社_社内規程')
        expect(await igit.listRemotes({ fs, dir: dest })).toEqual([])
        expect((await git.log(dest)).length).toBe(2)
        expect(await igit.listTags({ fs, dir: dest })).toHaveLength(2)
        expect((await sch.listEvents(dest)).length).toBe(5)
        await expect(duplicateRepo(src.dir, parent, '別会社_社内規程')).rejects.toThrow('同じ名前のフォルダ')
        await expect(duplicateRepo(src.dir, src.dir, '中')).rejects.toThrow('元のリポジトリの中')
        await expect(duplicateRepo(src.dir, parent, 'a/b')).rejects.toThrow('名前が正しくありません')
    })
})

describe('フォーク', () => {
    it('フォークを作り、送信先をフォークに、元を upstream に切り替える', async () => {
        const gh = await import('../src/main/github')
        const settings = await import('../src/main/settings')
        vi.spyOn(settings, 'loadSettings').mockResolvedValue({ repos: [], author: { name: 't', email: '' }, username: '', prefs: {} } as never)
        const fork = vi
            .spyOn(gh, 'forkRepo')
            .mockResolvedValue({ full_name: 'me/rules', clone_url: 'https://github.com/me/rules.git', html_url: 'https://github.com/me/rules' })
        vi.spyOn(gh, 'getRepo').mockResolvedValue({
            full_name: 'me/rules',
            clone_url: 'https://github.com/me/rules.git',
            html_url: 'https://github.com/me/rules',
        })
        const { forkRepo } = await import('../src/main/repo-copy')
        const parent = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-fork-'))
        const [src] = await createSamples(parent)
        await igit.addRemote({ fs, dir: src.dir, remote: 'origin', url: 'https://github.com/owner/rules.git' })
        expect(await forkRepo(src.dir)).toBe('https://github.com/me/rules.git')
        expect(fork).toHaveBeenCalledWith({ owner: 'owner', repo: 'rules' })
        const remotes = Object.fromEntries((await igit.listRemotes({ fs, dir: src.dir })).map((r) => [r.remote, r.url]))
        expect(remotes).toEqual({ origin: 'https://github.com/me/rules.git', upstream: 'https://github.com/owner/rules.git' })
    })
})
