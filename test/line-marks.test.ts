import { describe, expect, it } from 'vitest'
import { lineSpans, stripMarks, withLineMarks } from '../src/shared/line-marks'
import { fixRadicals } from '../src/shared/radicals'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'

describe('withLineMarks', () => {
    const html = renderDoc(parseLegal('# 規程\n### 目的\n- この規程は、目的を定める。'))

    it('行番号のある要素の始めと終わりに目印を置く', () => {
        const out = withLineMarks(html)
        const lines = [...html.matchAll(/data-line="(\d+)"/g)].map((m) => m[1])
        expect(lines.length).toBeGreaterThan(0)
        for (const n of lines) {
            expect(out).toContain(`~cds${n}~`)
            expect(out).toContain(`~cde${n}~`)
        }
        const text = (s: string) => s.replace(/<style>[^<]*<\/style>/, '').replace(/<[^>]+>/g, '')
        expect(stripMarks(text(out))).toBe(text(html))
    })

    it('書き出す HTML には目印がない', () => {
        expect(html).not.toMatch(/~cd[se]\d+~/)
    })

    it('行番号が負の要素には置かない', () => {
        expect(withLineMarks('<p data-line="-1">a</p>')).not.toMatch(/~cd[se]/)
    })
})

describe('lineSpans', () => {
    it('始まりは最初の枚、終わりは最後の枚から取る', () => {
        const spans = lineSpans([
            [{ str: '~cds3~~cds4~', y: 0.1 }, { str: '本文', y: 0.2 }, { str: '~cde4~', y: 0.5 }],
            [{ str: '~cde3~', y: 0.3 }],
        ])
        expect(spans).toEqual([
            { line: 3, start: { page: 0, y: 0.1 }, end: { page: 1, y: 0.3 } },
            { line: 4, start: { page: 0, y: 0.1 }, end: { page: 0, y: 0.5 } },
        ])
    })

    it('目印から文字を消す', () => {
        expect(stripMarks('~cds1~第一条~cde1~')).toBe('第一条')
    })
})

describe('fixRadicals', () => {
    it('部首の文字を漢字に戻し、全角の数字はそのまま', () => {
        expect(fixRadicals('⻑い規程第⼀章（⾒出し１）')).toBe('長い規程第一章（見出し１）')
    })
})
