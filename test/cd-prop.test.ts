import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractProps, inlineRuns, parseProps, stripInlineProps } from '../src/shared/cd-prop'
import { parseLegal, articleLines } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'

describe('parseProps', () => {
    it('短い名前と CSS の名前を読む', () => {
        expect(parseProps('font-size="9pt" font-family="BIZ UDゴシック" text-align=right')).toEqual({
            fontSize: '9pt',
            fontFamily: 'BIZ UDゴシック',
            textAlign: 'right',
        })
        expect(parseProps('size=9 .center break cols=20,80% line=1.4')).toEqual({
            fontSize: '9pt',
            textAlign: 'center',
            break: true,
            cols: ['20%', '80%'],
            lineHeight: '1.4',
        })
    })

    it('危ない値は捨てる', () => {
        expect(parseProps('size="9pt;color:red" font="a;}<b>"')).toEqual({ fontFamily: 'ab' })
        expect(parseProps('align=evil cols="a,b"')).toEqual({})
    })
})

describe('extractProps', () => {
    it('範囲・1 行の指定・改ページを行に割り当て、指定の行は空にする', () => {
        const src = ['{break}', '### 目的', '::: {size=9pt}', '- 一', '- 二', ':::', '- 三'].join('\n')
        const { source, at } = extractProps(src)
        expect(source.split('\n')).toEqual(['', '### 目的', '', '- 一', '- 二', '', '- 三'])
        expect(at[1]).toEqual({ break: true })
        expect(at[3]).toEqual({ fontSize: '9pt' })
        expect(at[4]).toEqual({ fontSize: '9pt' })
        expect(at[6]).toBeUndefined()
    })

    it('範囲の break は最初の要素だけに付き、波かっこなしの書き方も読む', () => {
        const { at } = extractProps(['::: break right', 'a', '', 'b', ':::'].join('\n'))
        expect(at[1]).toEqual({ textAlign: 'right', break: true })
        expect(at[3]).toEqual({ textAlign: 'right' })
    })

    it('コードの囲みの中は読まない', () => {
        const src = ['```mermaid', ':::', '{x}', '```', 'a'].join('\n')
        const { source, at } = extractProps(src)
        expect(source).toBe(src)
        expect(at.filter(Boolean)).toEqual([])
    })
})

const SRC = [
    '# 規程',
    '## 総則',
    '### 目的',
    '- この規程は、[大事]{size=12pt}なことを定める。',
    '  ::: {size=9pt cols=30,70}',
    '  | 区分 | 内容 |',
    '  |---|---|',
    '  | A | B |',
    '  :::',
    '{break}',
    '### 定義',
    '- 定義する。',
    '## {closing}',
    '{right}',
    '以上',
].join('\n')

describe('文書への反映', () => {
    const doc = parseLegal(SRC)

    it('条・項・表・後文に設定が付く', () => {
        const [a1, a2] = doc.chapters[0].articles
        expect(a1.paragraphs).toHaveLength(1)
        expect(a1.paragraphs[0].blockProps?.[0]).toEqual({ fontSize: '9pt', cols: ['30%', '70%'] })
        expect(a2.props).toEqual({ break: true })
        expect(doc.chapters[1].parts?.[0].props).toEqual({ textAlign: 'right' })
    })

    it('描画に反映され、比べる文からは指定が消える', () => {
        const html = renderDoc(doc)
        expect(html).toContain('<span style="font-size:12pt">大事</span>')
        expect(html).toContain('<col style="width:30%">')
        expect(html).toMatch(/class="cd-article cd-break" style="break-before:page"/)
        expect(html).toContain('text-align:right')
        expect(html).not.toMatch(/\]\{|:::|\{right\}|\{break\}/)
        expect(articleLines(doc.chapters[0].articles[0], doc).join('')).not.toMatch(/\]\{|:::/)
    })

    it('文中の指定を分ける・消す', () => {
        expect(stripInlineProps('前[中]{size=9}後')).toBe('前中後')
        expect(inlineRuns('前[中]{size=9}後')).toEqual([{ text: '前' }, { text: '中', props: { fontSize: '9pt' } }, { text: '後' }])
    })

    it('条参照や指定のないかっこはそのまま', () => {
        expect(stripInlineProps('[[目的]]の規定')).toBe('[[目的]]の規定')
        const html = renderDoc(parseLegal('# 規程\n### 目的\n- [注]{} と書く。'))
        expect(html).toContain('[注]{}')
    })
})

describe('Word への反映', () => {
    it('改ページ・文字の大きさ・右寄せ・列の幅を Word に書く', async () => {
        const { docToDocx } = await import('../src/shared/docx-export')
        const xml = readZipEntry(await docToDocx(parseLegal(SRC)), 'word/document.xml')
        expect(xml).toContain('<w:pageBreakBefore/>')
        expect(xml).toContain('<w:sz w:val="18"/>')
        expect(xml).toContain('<w:jc w:val="right"/>')
        expect(xml).not.toMatch(/:::|\{right\}|\{break\}/)
        const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]))
        expect(cols[1] / cols[0]).toBeCloseTo(70 / 30, 1)
    })
})

function readZipEntry(zip: Buffer, name: string): string {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    let at = zip.readUInt32LE(eocd + 16)
    const count = zip.readUInt16LE(eocd + 10)
    for (let i = 0; i < count; i++) {
        const method = zip.readUInt16LE(at + 10)
        const size = zip.readUInt32LE(at + 20)
        const nameLen = zip.readUInt16LE(at + 28)
        const extra = zip.readUInt16LE(at + 30)
        const comment = zip.readUInt16LE(at + 32)
        const local = zip.readUInt32LE(at + 42)
        if (zip.toString('utf8', at + 46, at + 46 + nameLen) === name) {
            const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
            const data = zip.subarray(start, start + size)
            return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
        }
        at += 46 + nameLen + extra + comment
    }
    throw new Error(`${name} がありません`)
}
