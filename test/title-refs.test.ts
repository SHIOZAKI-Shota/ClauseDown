import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { articleTitle, parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { compareSources } from '../src/shared/article-diff'
import { docToDocx } from '../src/shared/docx-export'
import { toHouritsu } from '../src/shared/houritsu'

const SRC = `# 規則
### 目的 {#purpose}
- 目的を定める。
### [[purpose]]の特例
- 特例を定める。
### [[nope]]の読替え
- 読み替える。
`

describe('条見出しの中の条参照', () => {
    it('プレビューで「第○条」に置き換え、参照先がなければ参照切れとして示す', () => {
        const html = renderDoc(parseLegal(SRC))
        expect(html).toContain('<p class="cd-art-title">（第1条の特例）</p>')
        expect(html).toMatch(/<p class="cd-art-title">（<span class="cd-missing"[^>]*>\[\[nope\]\]<\/span>の読替え）<\/p>/)
    })

    it('見出しを条番号の後ろに書く形式でも置き換える', () => {
        const src = SRC.replace('# 規則\n', '# 規則\n<!-- clausedown\narticle: { title: inline }\n-->\n')
        expect(renderDoc(parseLegal(src))).toContain('（第1条の特例）</p>')
    })

    it('目次などで使う見出しの文字も置き換える。文書の中身は書いたまま', () => {
        const doc = parseLegal(SRC)
        const a = doc.chapters[0].articles[1]
        expect(articleTitle(a, doc)).toBe('第1条の特例')
        expect(a.title).toBe('[[purpose]]の特例')
    })

    it('新旧対照表では、参照先の条番号がずれても同じ条として対応づけ、表の文字は新しい番号にする', () => {
        const next = SRC.replace('### 目的 {#purpose}', '### 定義\n- 用語を定める。\n### 目的 {#purpose}')
        const rows = compareSources(SRC, next)
        const row = rows.find((r) => r.oldParts.some((p) => p.text.includes('の特例')))!
        expect(row.status).toBe('changed')
        expect(row.oldParts.map((p) => p.text).join('')).toContain('第1条の特例')
        expect(row.newParts.map((p) => p.text).join('')).toContain('第2条の特例')
        expect(rows.filter((r) => r.status === 'added')).toHaveLength(1)
    })

    it('Word と houritsu 形式でも置き換える', async () => {
        const xml = strFromU8(unzipSync(new Uint8Array(await docToDocx(parseLegal(SRC))))['word/document.xml'])
        expect(xml).toContain('第1条の特例')
        expect(xml).not.toContain('[[purpose]]')
        const md = toHouritsu(SRC)
        expect(md).toContain('の特例）')
        expect(md).not.toContain('[[purpose]]')
    })
})
