import { describe, expect, it } from 'vitest'
import { parseLegal, articleLines } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { compareSources } from '../src/shared/article-diff'
import { docToDocx } from '../src/shared/docx-export'
import { parseTable, blockLines } from '../src/shared/blocks'

const SRC = `# 賃金規程

### 手当
- 手当は、次の表のとおりとする。

  | 手当 | 月額 |
  |---|---|
  | 住宅手当 | 10,000円 |
  | 家族手当 | 5,000円 |

- 支給の流れは次のとおりとする。

  \`\`\`mermaid
  flowchart LR
    A[申請] --> B[承認]
  \`\`\`

### 支給日
- 毎月25日とする。

## 別表第一 {appendix}
基本給の等級は次のとおり。

| 等級 | 基本給 |
|---|---|
| 1 | 200,000円 |
`

describe('表と図', () => {
    const doc = parseLegal(SRC)

    it('表と図は項の下に付き、表のセルを項として数えない', () => {
        const a = doc.chapters[0].articles[0]
        expect(a.paragraphs.length).toBe(2)
        expect(a.paragraphs[0].blocks[0]).toMatch(/^\| 手当 \| 月額 \|/)
        expect(a.paragraphs[1].blocks[0]).toMatch(/^```mermaid/)
        expect(doc.chapters[0].articles[1].label).toBe('第2条')
        expect(doc.chapters[1]).toMatchObject({ kind: 'appendix', title: '別表第一' })
    })

    it('対照表用の行に表の中身が入る', () => {
        const lines = articleLines(doc.chapters[0].articles[0], doc)
        expect(lines).toContain('　　［表］')
        expect(lines).toContain('　　　住宅手当｜10,000円')
        expect(lines).toContain('　　［図］')
    })

    it('表の金額を変えると対照表で変更になる。別表の変更も出る', () => {
        const rows = compareSources(SRC, SRC.replace('10,000円', '12,000円').replace('200,000円', '210,000円'))
        expect(rows.filter((r) => r.status === 'changed').length).toBe(2)
    })

    it('HTML に表と SVG の図が出る', () => {
        const html = renderDoc(doc)
        expect(html).toContain('<table>')
        expect(html).toContain('<td>住宅手当</td>')
        expect(html).toMatch(/<figure class="cd-figure"><svg[^>]*class="pele/)
        expect(html).toContain('<h2 class="cd-appendix-title">別表第一</h2>')
    })

    it('図の書き方の誤りは描かずに知らせる', () => {
        const html = renderDoc(parseLegal('# t\n### a\n- x\n\n  ```mermaid\n  これは図ではない\n  ```\n'))
        expect(html).toContain('図を描けません')
    })

    it('Word にも出せる（図は画像がなければ注記）', async () => {
        const buf = await docToDocx(doc)
        expect(buf.subarray(0, 2).toString()).toBe('PK')
    })

    it('parseTable / blockLines', () => {
        expect(parseTable('| a | b |\n|---|---|\n| 1 | 2 |')).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ])
        expect(blockLines('```mermaid\nflowchart LR\n  A --> B\n```')).toEqual(['［図］', '　flowchart LR', '　A --> B'])
    })
})
