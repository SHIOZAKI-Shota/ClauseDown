import { describe, expect, it } from 'vitest'
import { cleanGitLabHosts, isRepoUrlFor, knownBases, matchRemote, newRepoUrl, normalizeBase } from '../src/shared/forge'

const bases = knownBases({ gitlabHosts: [{ url: 'https://gitlab.example.co.jp' }, { url: 'https://example.co.jp/gitlab' }] })

describe('リモートの URL', () => {
    it('GitHub は owner/repo、GitLab はサブグループも見分ける', () => {
        expect(matchRemote('https://github.com/office/docs.git', bases)).toMatchObject({ kind: 'github', path: 'office/docs' })
        expect(matchRemote('https://x-access-token@github.com/office/docs', bases)).toMatchObject({ kind: 'github', path: 'office/docs' })
        expect(matchRemote('https://github.com/office/sub/docs', bases)).toBeNull()
        expect(matchRemote('https://gitlab.com/office/sub/docs.git/', bases)).toMatchObject({
            kind: 'gitlab',
            base: 'https://gitlab.com',
            path: 'office/sub/docs',
        })
        expect(matchRemote('https://GitLab.Example.co.jp/a/b', bases)).toMatchObject({ base: 'https://gitlab.example.co.jp', path: 'a/b' })
    })

    it('パス付きで置かれた GitLab は、より長いベースで見分ける', () => {
        expect(matchRemote('https://example.co.jp/gitlab/office/docs.git', bases)).toMatchObject({ base: 'https://example.co.jp/gitlab', path: 'office/docs' })
        expect(matchRemote('https://example.co.jp/gitlab-evil/office/docs.git', bases)).toBeNull()
    })

    it('知らないサーバー・似た名前のサーバー・http・ssh は認めない', () => {
        expect(matchRemote('https://gitlab.example.co.jp.evil.com/a/b.git', bases)).toBeNull()
        expect(matchRemote('https://evil.com/github.com/a/b', bases)).toBeNull()
        expect(matchRemote('http://gitlab.com/a/b.git', bases)).toBeNull()
        expect(matchRemote('git@gitlab.com:a/b.git', bases)).toBeNull()
        expect(matchRemote('https://gitlab.com/a/../b', bases)).toBeNull()
        expect(matchRemote('https://gitlab.com/onlyone', bases)).toBeNull()
    })

    it('設定の社内 GitLab は https だけを、決まった形にして残す', () => {
        expect(normalizeBase('https://GitLab.Example.co.jp/gitlab/')).toBe('https://gitlab.example.co.jp/gitlab')
        expect(normalizeBase('http://gitlab.example.co.jp')).toBeNull()
        expect(normalizeBase('https://user@gitlab.example.co.jp')).toBeNull()
        expect(normalizeBase('https://gitlab.example.co.jp/?x=1')).toBeNull()
        expect(
            cleanGitLabHosts([
                { url: 'https://a.jp/' },
                { url: 'https://a.jp' },
                { url: 'https://gitlab.com' },
                { url: 'ftp://b' },
                { url: 'https://c.jp', clientId: 'id<script>' },
            ]),
        ).toEqual([{ url: 'https://a.jp' }, { url: 'https://c.jp' }])
    })

    it('共有を始めるときの URL の確認と、新しいリポジトリを作る画面', () => {
        const gl = { base: 'https://gitlab.example.co.jp', kind: 'gitlab' as const }
        expect(isRepoUrlFor('https://gitlab.example.co.jp/office/sub/docs', gl)).toBe(true)
        expect(isRepoUrlFor('https://gitlab.com/office/docs', gl)).toBe(false)
        expect(newRepoUrl(gl, '規程')).toBe('https://gitlab.example.co.jp/projects/new#blank_project')
        expect(newRepoUrl({ base: 'https://github.com', kind: 'github' }, '規程')).toContain('name=%E8%A6%8F%E7%A8%8B')
    })
})
