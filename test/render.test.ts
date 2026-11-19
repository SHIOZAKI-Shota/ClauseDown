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

describe('折り返しの位置', () => {
    const contract = (hang: string) =>
        [
            '# 契約書',
            '<!-- clausedown',
            `paragraph: { numeral: arabic, hang: ${hang} }`,
            'item: { style: paren }',
            '-->',
            '',
            '### 目的',
            '- 本文。',
            '- 第2項。',
            '  - 号。',
            '',
        ].join('\n')

    it('本文の頭にそろえるときは、番号と本文を分けて描く', () => {
        const html = renderDoc(parseLegal(contract('text')))
        expect(html).toContain('cd-hang-text')
        expect(html).toContain('<span class="cd-lbl"><span class="cd-num">2</span>　</span><span class="cd-txt">第2項。</span>')
        expect(html).toContain('<span class="cd-lbl"><span class="cd-num">（1）</span>　</span><span class="cd-txt">号。</span>')
    })

    it('1 字下げ（既定）のときは今までどおり', () => {
        const html = renderDoc(parseLegal(contract('char')))
        expect(html).not.toContain('cd-hang-text')
        expect(html).not.toContain('cd-lbl')
        expect(parseLegal('# t\n### a\n- b\n').config.paragraph.hang).toBe('char')
    })

    it('Word でも番号の幅だけぶら下げる', async () => {
        const { unzipSync, strFromU8 } = await import('fflate')
        const xml = (hang: string) => docToDocx(parseLegal(contract(hang))).then((b) => strFromU8(unzipSync(new Uint8Array(b))['word/document.xml']))
        expect(await xml('text')).toContain('w:hanging="315"')
        expect(await xml('char')).not.toContain('w:hanging="315"')
    })
})
