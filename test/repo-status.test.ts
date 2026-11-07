import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const { explain } = await import('../src/main/git-base')

describe('リポジトリが見つからないとき', () => {
    it('フォルダがない・版管理されていない・正常を見分ける', async () => {
        const ok = fs.mkdtempSync(join(os.tmpdir(), 'cd-ok-'))
        await git.initRepo(ok)
        const plain = fs.mkdtempSync(join(os.tmpdir(), 'cd-plain-'))
        const gone = join(os.tmpdir(), 'cd-gone-' + Date.now())
        expect(await git.repoStatus([ok, plain, gone])).toEqual({ [ok]: 'ok', [plain]: 'notGit', [gone]: 'missing' })
    })

    it('リモートのリポジトリが見つからない（404）ときは、理由が分かる文で知らせる', () => {
        const msg = explain({ code: 'HttpError', message: 'HTTP Error: 404 Not Found', data: { statusCode: 404 } })
        expect(msg).toContain('リモートのリポジトリが見つかりません')
        expect(msg).toContain('削除')
    })
})
