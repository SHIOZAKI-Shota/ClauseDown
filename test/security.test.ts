import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { cleanStyle, cssFont, DEFAULT_STYLE } from '../src/shared/prefs'

vi.mock('../src/main/settings', () => ({
    getToken: async () => 'secret-token',
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const base = await import('../src/main/git-base')
const git = await import('../src/main/git')

describe('リモートから届く書式（style.json）', () => {
    it('フォント名の記号を取り除き、日本語・英数字は残す', () => {
        expect(cleanStyle({ font: '03スマートフォントUI' }).font).toBe('03スマートフォントUI')
        expect(cleanStyle({ font: 'BIZ UD明朝 Medium' }).font).toBe('BIZ UD明朝 Medium')
        expect(cleanStyle({ font: 'x</style><meta http-equiv=refresh>' }).font).not.toMatch(/[<>"=;{}]/)
    })
    it('数値は範囲に収め、文字列で CSS を差し込めない', () => {
        const s = cleanStyle({ fontSize: '10.5pt} body{display:none' as unknown as number, lineHeight: 99, margin: -5 })
        expect(s.fontSize).toBe(DEFAULT_STYLE.fontSize)
        expect(s.lineHeight).toBe(3)
        expect(s.margin).toBe(5)
    })
    it('font-family に引用符や括弧を残さない', () => {
        expect(cssFont('a"; } body { x')).toMatch(/^"a  body  x", /)
    })
})

describe('リモートとトークン', () => {
    it('https とこの PC の中だけをリモートとして認める', () => {
        expect(base.safeRemoteUrl('https://github.com/a/b.git')).toBe(true)
        expect(base.safeRemoteUrl('http://127.0.0.1:8080/x.git')).toBe(true)
        expect(base.safeRemoteUrl('http://example.com/x.git')).toBe(false)
        expect(base.safeRemoteUrl('file:///C:/x')).toBe(false)
    })
    it('GitHub 以外のサーバーにはトークンを渡さない', async () => {
        const ask = (url: string) => base.onAuth(url, {} as never) as Promise<{ cancel?: boolean; password?: string }>
        expect((await ask('https://evil.example.com/x.git')).cancel).toBe(true)
        expect((await ask('http://github.com/a/b.git')).cancel).toBe(true)
        expect((await ask('https://github.com/a/b.git')).password).toBe('secret-token')
    })
})

describe('リポジトリの外への書き込み', () => {
    it('../ やシンボリックリンクを通って外に書けない', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-sec-'))
        const outside = fs.mkdtempSync(join(os.tmpdir(), 'cd-out-'))
        await expect(git.writeDoc(dir, '../x.md', 'x')).rejects.toThrow('不正なパス')
        let linked = true
        try {
            fs.symlinkSync(outside, join(dir, 'link'), 'junction')
        } catch {
            linked = false
        }
        if (linked) {
            await expect(git.writeDoc(dir, 'link/x.md', 'x')).rejects.toThrow('リンク')
            expect(fs.existsSync(join(outside, 'x.md'))).toBe(false)
        }
    })
})
