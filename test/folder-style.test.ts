import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import isogit from 'isomorphic-git'
import { cleanOverride, folderChain, inheritedStyle, resolveStyle } from '../src/shared/folder-style'
import { DEFAULT_STYLE } from '../src/shared/prefs'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const fstyle = await import('../src/main/folder-style')

describe('書式の重ね合わせ', () => {
    const app = { ...DEFAULT_STYLE, font: 'PCのフォント', fontSize: 10 }
    const layers = {
        '': { font: 'リポジトリのフォント' },
        株式会社A: { fontSize: 12 },
        '株式会社A/規程': { lineHeight: 2 },
    }

    it('親フォルダを上から順に並べる', () => {
        expect(folderChain('株式会社A/規程/就業規則.md')).toEqual(['', '株式会社A', '株式会社A/規程'])
        expect(folderChain('README.md')).toEqual([''])
        expect(folderChain('株式会社A', true)).toEqual(['', '株式会社A'])
    })

    it('この PC → リポジトリ → フォルダの順に、項目ごとに上書きする', () => {
        const r = resolveStyle(app, layers, '株式会社A/規程/就業規則.md')
        expect(r.style).toMatchObject({ font: 'リポジトリのフォント', fontSize: 12, lineHeight: 2, margin: DEFAULT_STYLE.margin })
        expect(r.from).toMatchObject({ font: '', fontSize: '株式会社A', lineHeight: '株式会社A/規程', margin: 'app' })
        expect(resolveStyle(app, layers, 'B商店/就業規則.md').style.fontSize).toBe(10)
    })

    it('フォルダ自身の上書きを除いた「受け継ぐ書式」', () => {
        const r = inheritedStyle(app, layers, '株式会社A')
        expect(r.style.fontSize).toBe(10)
        expect(r.from.fontSize).toBe('app')
        expect(r.style.font).toBe('リポジトリのフォント')
    })

    it('書いてある項目だけを、安全な値にして残す', () => {
        expect(cleanOverride({ fontSize: 99, foo: 1 })).toEqual({ fontSize: 30 })
        expect(cleanOverride('x')).toEqual({})
    })
})

describe('書式ファイル（.clausedown/ の下）の読み書き', () => {
    it('保存すると版になり、変えていなければ版を作らない。空にしたフォルダのファイルは消す', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-style-'))
        await git.initRepo(dir)
        fs.mkdirSync(join(dir, '株式会社A'))
        await git.writeDoc(dir, '株式会社A/就業規則.md', '# 就業規則\n')
        await git.saveVersion(dir, { message: '初版' })

        await git.writeDoc(dir, '株式会社A/就業規則.md', '# 就業規則\n\n編集中\n')
        expect(await fstyle.saveFolderStyle(dir, '株式会社A', { fontSize: 12 })).toBe(true)
        expect(await fstyle.saveFolderStyle(dir, '株式会社A', { fontSize: 12 })).toBe(false)
        expect(await fstyle.listFolderStyles(dir)).toEqual({ 株式会社A: { fontSize: 12 } })
        const [last] = await isogit.log({ fs, dir, depth: 1 })
        expect(last.commit.message).toContain('書式を変更（株式会社A）')
        expect(await git.readAt(dir, last.oid, '株式会社A/就業規則.md')).toBe('# 就業規則\n')
        expect((await git.listDocs(dir)).find((d) => d.path === '株式会社A/就業規則.md')?.changed).toBe(true)

        expect(fs.existsSync(join(dir, '.clausedown', 'styles', '株式会社A.json'))).toBe(true)
        expect(fs.readdirSync(join(dir, '株式会社A'))).toEqual(['就業規則.md'])
        expect(await fstyle.saveFolderStyle(dir, '', { fontSize: 11 })).toBe(true)
        expect(fs.existsSync(join(dir, '.clausedown', 'style.json'))).toBe(true)
        expect(await fstyle.listFolderStyles(dir)).toEqual({ '': { fontSize: 11 }, 株式会社A: { fontSize: 12 } })

        expect(await fstyle.saveFolderStyle(dir, '株式会社A', {})).toBe(true)
        expect(fs.existsSync(join(dir, '.clausedown', 'styles', '株式会社A.json'))).toBe(false)
        await expect(fstyle.saveFolderStyle(dir, 'ない', { fontSize: 12 })).rejects.toThrow('見つかりません')
        await expect(fstyle.saveFolderStyle(dir, '../x', { fontSize: 12 })).rejects.toThrow()
    })
})
