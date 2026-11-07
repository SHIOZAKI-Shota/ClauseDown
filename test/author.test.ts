import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import isogit from 'isomorphic-git'

const state = {
    settings: { repos: [], author: { name: '', email: '' }, username: '', identityDefault: undefined as string | undefined },
    creds: {} as Record<string, { method: 'app'; access: string; login?: string; name?: string; email?: string }>,
}
vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => structuredClone(state.settings),
    listCredentials: async () => structuredClone(state.creds),
}))

const base = await import('../src/main/git-base')
const git = await import('../src/main/git')

const GITHUB = { method: 'app' as const, access: 'x', login: 'staff-a', name: '山田 太郎', email: '42+staff-a@users.noreply.github.com' }
const GITLAB = { method: 'app' as const, access: 'y', login: 'yamada', name: '山田（GitLab）', email: 'yamada@example.co.jp' }

async function repo(url?: string) {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-author-'))
    await git.initRepo(dir)
    if (url) await isogit.addRemote({ fs, dir, remote: 'origin', url })
    return dir
}

let gh: string, gl: string, local: string
beforeAll(async () => {
    gh = await repo('https://github.com/office/docs.git')
    gl = await repo('https://gitlab.com/office/docs.git')
    local = await repo()
})
beforeEach(() => {
    state.settings.author = { name: '', email: '' }
    state.settings.identityDefault = undefined
    state.creds = {}
})

describe('版の作成者', () => {
    it('リモートのアカウントにログインしていれば、そのプロフィール', async () => {
        state.creds = { 'https://github.com': GITHUB, 'https://gitlab.com': GITLAB }
        expect(await base.identity(gh)).toMatchObject({ name: '山田 太郎', login: 'staff-a', source: 'github' })
        expect(await base.identity(gl)).toMatchObject({ name: '山田（GitLab）', login: 'yamada', source: 'gitlab' })
        expect(await base.author(gh)).toEqual({ name: '山田 太郎', email: '42+staff-a@users.noreply.github.com' })
    })

    it('リモートが無いリポジトリは既定。既定が無ければログイン中の最初のアカウント', async () => {
        state.creds = { 'https://gitlab.com': GITLAB }
        state.settings.author = { name: '手入力', email: '' }
        expect(await base.identity(local)).toMatchObject({ source: 'gitlab', name: '山田（GitLab）' })
    })

    it('自分で入力するにしていれば、リモートのアカウントより手入力の名前を使う', async () => {
        state.creds = { 'https://gitlab.com': GITLAB }
        state.settings.author = { name: '手入力', email: '' }
        state.settings.identityDefault = 'manual'
        expect(await base.identity(local)).toMatchObject({ source: 'manual', name: '手入力', email: '' })
        expect(await base.identity(gl)).toMatchObject({ source: 'manual', name: '手入力' })
    })

    it('リモートにログインしていなければ既定、それも無ければ手入力', async () => {
        state.creds = { 'https://gitlab.com': GITLAB }
        state.settings.identityDefault = 'https://gitlab.com'
        expect(await base.identity(gh)).toMatchObject({ source: 'gitlab' })
        state.creds = {}
        state.settings.author = { name: '手入力', email: 'me@example.com' }
        expect(await base.author(gh)).toEqual({ name: '手入力', email: 'me@example.com' })
    })

    it('既定を手入力にしていて名前が空なら、ログイン中のアカウントを使う', async () => {
        state.creds = { 'https://github.com': GITHUB }
        state.settings.identityDefault = 'manual'
        expect(await base.identity(local)).toMatchObject({ source: 'github' })
    })

    it('プロフィールの無い認証情報（以前の版のトークン）は使わない。どれも無ければ版を保存できない', async () => {
        state.creds = { 'https://github.com': { method: 'app', access: 'x' } }
        expect(await base.identity(gh)).toBeNull()
        await expect(base.author(gh)).rejects.toThrow('ログインするか、名前を入力してください')
    })
})
