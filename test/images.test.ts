import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { imageDest, imageLine, imagePathOf, imageSize, markdownSrc, rewriteImages, sniffImage } from '../src/shared/images'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { docToDocx } from '../src/shared/docx-export'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))
const git = await import('../src/main/git')
const images = await import('../src/main/images')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

describe('画像のパス', () => {
    it('文書からの相対パスを、リポジトリからのパスに直す', () => {
        expect(imagePathOf('規程/就業規則.md', 'images/就業規則/20261110-093000.png')).toBe('規程/images/就業規則/20261110-093000.png')
        expect(imagePathOf('就業規則.md', 'images/a.png')).toBe('images/a.png')
        expect(imagePathOf('規程/就業規則.md', '../共通/図.jpg')).toBe('共通/図.jpg')
        expect(imagePathOf('規程/就業規則.md', 'images/%E5%9B%B3%201.png')).toBe('規程/images/図 1.png')
    })
    it('リポジトリの外・URL・画像でないものは null', () => {
        expect(imagePathOf('就業規則.md', '../secret.png')).toBeNull()
        expect(imagePathOf('就業規則.md', 'https://example.com/a.png')).toBeNull()
        expect(imagePathOf('就業規則.md', '/etc/passwd.png')).toBeNull()
        expect(imagePathOf('就業規則.md', 'C:/x/a.png')).toBeNull()
        expect(imagePathOf('就業規則.md', 'images/a.svg')).toBeNull()
        expect(imagePathOf('就業規則.md', 'images/a.exe')).toBeNull()
    })
    it('保存先は文書と同じディレクトリの images/文書名/日時', () => {
        const d = imageDest('規程/就業規則.md', 'png', new Date(2026, 10, 10, 9, 30, 5))
        expect(d).toEqual({ path: '規程/images/就業規則/20261110-093005.png', src: 'images/就業規則/20261110-093005.png' })
        expect(markdownSrc('images/my doc (1)/a.png')).toBe('images/my%20doc%20%281%29/a.png')
    })
    it('画像だけの行を見分ける', () => {
        expect(imageLine('  ![図](images/a.png)')).toEqual({ alt: '図', src: 'images/a.png' })
        expect(imageLine('![](images/a.png "題")')).toEqual({ alt: '', src: 'images/a.png' })
        expect(imageLine('本文 ![図](images/a.png)')).toBeNull()
    })
    it('HTML の img の src を差し替える', () => {
        const html = '<p><img src="images/%E5%9B%B3.png" alt="図"> と <img src="https://x/y.png" alt=""></p>'
        const out = rewriteImages(html, (src) => (src.startsWith('http') ? null : `app://bundle/__repo/d/${encodeURIComponent(src)}`))
        expect(out).toBe('<p><img src="app://bundle/__repo/d/images%2F%25E5%259B%25B3.png" alt="図"> と <img src="https://x/y.png" alt=""></p>')
    })
    it('形式と大きさを読む', () => {
        expect(sniffImage(PNG)).toBe('png')
        expect(imageSize(PNG)).toEqual({ width: 1, height: 1 })
        expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull()
    })
})

describe('画像の保存と版', () => {
    it('保存した画像は文書と一緒に版に入り、プレビューと Word に出る', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-img-'))
        await git.initRepo(dir)
        await git.createDoc(dir, '規程/就業規則.md', '就業規則')
        await git.saveVersion(dir, { message: '初版' })

        const saved = await images.saveImage(dir, '規程/就業規則.md', new Uint8Array(PNG), 'png')
        expect(saved.path).toMatch(/^規程\/images\/就業規則\/\d{8}-\d{6}\.png$/)
        expect(fs.existsSync(join(dir, saved.path))).toBe(true)
        const again = await images.saveImage(dir, '規程/就業規則.md', new Uint8Array(PNG), 'png')
        expect(again.path).not.toBe(saved.path)

        const text = `# 就業規則\n\n### 第1条 目的\n- 本文\n  ![図](${saved.src})\n`
        await git.writeDoc(dir, '規程/就業規則.md', text)
        const changed = await git.changedPaths(dir)
        expect(changed.has('規程/就業規則.md')).toBe(true)
        expect(changed.has(saved.path)).toBe(true)
        await git.saveVersion(dir, { message: '図を追加' })
        expect((await git.changedPaths(dir)).has(saved.path)).toBe(false)
        const [last] = await git.log(dir)
        expect(await git.readAt(dir, last.oid, saved.path).catch(() => null)).not.toBeNull()

        const html = renderDoc(parseLegal(text))
        expect(html).toContain(`<img src="${saved.src.replace(/就業規則/, encodeURIComponent('就業規則'))}" alt="図">`)

        const img = await images.readImage(dir, '規程/就業規則.md', saved.src)
        expect(img?.ext).toBe('png')
        expect(await images.readImage(dir, '規程/就業規則.md', '../../x.png')).toBeNull()

        const docx = await docToDocx(parseLegal(text), undefined, undefined, new Map([[saved.src, { data: new Uint8Array(PNG), type: 'png', width: 1, height: 1 }]]))
        expect(docx.length).toBeGreaterThan(1000)
        await expect(images.saveImage(dir, '規程/就業規則.md', new Uint8Array([1, 2, 3, 4]), 'png')).rejects.toThrow('PNG・JPEG')
        fs.rmSync(dir, { recursive: true, force: true })
    })
})
