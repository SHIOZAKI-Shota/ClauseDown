import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { imageMarksHtml, parseImageProps, stripImageMarks } from '../src/shared/cd-prop'
import { docToDocx } from '../src/shared/docx-export'
import { imageLine, inlineImages } from '../src/shared/images'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { kanjiLayout, sealSvg } from '../src/shared/seal'
import { setLocale } from '../src/shared/i18n'

setLocale('ja')

describe('丸印', () => {
    it('1〜4 字を円の中に置き、5 字以上は断る', () => {
        expect(kanjiLayout('山')).toHaveLength(1)
        expect(kanjiLayout('山田').map((g) => g.y)).toEqual([64, 136])
        expect(kanjiLayout('山田花').map((g) => g.y)).toEqual([50, 100, 150])
        const four = kanjiLayout('山田花子')
        expect(four.map((g) => [g.ch, g.x > 100 ? '右' : '左', g.y < 100 ? '上' : '下'])).toEqual([
            ['山', '右', '上'],
            ['田', '右', '下'],
            ['花', '左', '上'],
            ['子', '左', '下'],
        ])
        for (const g of four) expect(Math.hypot(g.x - 100, g.y - 100) + g.size / 2).toBeLessThan(92)
        expect(() => kanjiLayout('山田花子太')).toThrow()
        expect(() => kanjiLayout(' ')).toThrow()
    })

    it('SVG に色と文字を入れ、文字は逃がす', () => {
        const svg = sealSvg({ text: '<山>', style: 'kanji', color: '#123456' })
        expect(svg).toContain('stroke="#123456"')
        expect(svg).toContain('&lt;')
        expect(sealSvg({ text: '山', style: 'kanji', color: 'red;x' })).toContain('#d7261e')
    })

    it('英字は名前を上の弧に沿わせ、中央にイニシャルを置く', () => {
        const svg = sealSvg({ text: 'Jane Smith', style: 'latin', sub: '2026-11-15' })
        expect(svg).toContain('<textPath href="#t"')
        expect(svg).toContain('JANE SMITH')
        expect(svg).toContain('2026-11-15')
        expect(svg).toMatch(/>JS<\/text>/)
    })
})

describe('印影・署名の画像の指定', () => {
    it('{seal}・{sign} と大きさを読み、ほかは受け付けない', () => {
        expect(parseImageProps('seal')).toEqual({ kind: 'seal', height: '15mm' })
        expect(parseImageProps('seal=12mm')).toEqual({ kind: 'seal', height: '12mm' })
        expect(parseImageProps('sign=2cm')).toEqual({ kind: 'sign', height: '20mm' })
        expect(parseImageProps('sign=1000')).toEqual({ kind: 'sign', height: '60mm' })
        expect(parseImageProps('seal onload=x')).toBeNull()
        expect(parseImageProps('size=9pt')).toBeNull()
    })

    it('HTML では cd-seal の印にし、文字では指定を取り除く', () => {
        expect(imageMarksHtml('<p>山田 <img src="a.png" alt="印">{seal}</p>')).toBe(
            '<p>山田 <img src="a.png" alt="印" class="cd-seal" style="height:15mm"></p>',
        )
        expect(imageMarksHtml('<img src="a.png" alt="">{evil}')).toBe('<img src="a.png" alt="">{evil}')
        expect(stripImageMarks('山田 ![印](a.png){seal=12mm}')).toBe('山田 ![印](a.png)')
        expect(imageLine('![印](images/a.png){seal}')).toEqual({ alt: '印', src: 'images/a.png', attrs: 'seal' })
        expect(inlineImages('甲 ![印](a.png){seal} 乙 ![署名](b.png)').map((i) => [i.src, i.attrs])).toEqual([
            ['a.png', 'seal'],
            ['b.png', undefined],
        ])
    })

    it('署名欄の印影がプレビューに出る', () => {
        const doc = parseLegal('# 契約書\n\n### 目的\n- 本文\n\n## {closing}\n甲　見本株式会社　代表取締役　見本 太郎 ![印](images/a.png){seal}\n')
        expect(renderDoc(doc)).toContain('class="cd-seal"')
    })

    it('Word では署名欄の画像を画像として入れる（文字のままにしない）', async () => {
        const doc = parseLegal('# 契約書\n\n### 目的\n- 本文\n\n## {closing}\n![印](a.png){seal}\n\n乙　中村 ![署名](b.png){sign}\n')
        const png = { data: new Uint8Array([137, 80, 78, 71]), type: 'png' as const, width: 300, height: 300 }
        const bytes = await docToDocx(
            doc,
            new Map(),
            undefined,
            new Map([
                ['a.png', png],
                ['b.png', { ...png, width: 600, height: 200 }],
            ]),
        )
        const xml = await unzipDocument(bytes)
        expect((xml.match(/<pic:pic\b/g) ?? []).length).toBe(2)
        expect(xml).not.toContain('{seal}')
        expect(xml).not.toContain('![')
    })
})

async function unzipDocument(bytes: Uint8Array): Promise<string> {
    return strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
}
