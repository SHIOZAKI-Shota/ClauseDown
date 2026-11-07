import { describe, expect, it } from 'vitest'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc, renderCompareTable } from '../src/shared/legal-renderer'
import { compareSources } from '../src/shared/article-diff'
import { docToDocx, compareToDocx } from '../src/shared/docx-export'

const SRC = `# 規則
### 目的 {#p}
- 本則は<b>x</b>[[p]]と[[nope]]による。
  - 号
`

describe('renderDoc', () => {
    const html = renderDoc(parseLegal(SRC))
    it('条番号・項・号を描画し、生のHTMLは通さない', () => {
        expect(html).toContain('<p class="cd-art-title">（目的）</p>')
        expect(html).toContain('<span class="cd-num">第1条</span>　本則は&lt;b&gt;x&lt;/b&gt;第1条と')
        expect(html).toContain('<span class="cd-missing"')
        expect(html).toContain('<p class="cd-item cd-lv1" data-line="3"><span class="cd-num">一</span>　号</p>')
    })
    it('削除された条・本文のない条は、条の位置から書く（第2項以降の字下げを付けない）', () => {
        const h = renderDoc(parseLegal('# 規則\n### 目的\n- 本文\n### {deleted}\n### 空\n'))
        expect(h).toContain('<p class="cd-para cd-first"><span class="cd-num">第2条</span>　削除</p>')
        expect(h).toContain('<p class="cd-para cd-first"><span class="cd-num">第3条</span></p>')
    })
    it('対照表', () => {
        const t = renderCompareTable(compareSources(SRC, SRC.replace('号', '号号')))
        expect(t).toContain('<u class="cd-chg">号</u>')
    })
})

describe('docx', () => {
    it('Word ファイルを生成できる', async () => {
        const a = await docToDocx(parseLegal(SRC))
        const b = await compareToDocx(compareSources(SRC, SRC.replace('号', '号号')), { omitUnchanged: true })
        expect(a.subarray(0, 2).toString()).toBe('PK')
        expect(b.length).toBeGreaterThan(1000)
    })
})
