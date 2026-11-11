import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { displayLine, findMath, mathError, mathKey } from '../src/shared/math'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { docToDocx } from '../src/shared/docx-export'
import { blockLines } from '../src/shared/blocks'

const SRC = [
    '# 補助金交付要綱',
    '### 補助金の額',
    '- 補助金の額は、$S = \\frac{C \\times 2}{3}$とする。',
    '- 上限は次の式による。',
    '  ```math',
    '  \\min\\left( S,\\ 1{,}000{,}000 \\right)',
    '  ```',
    '- 端数は次による。',
    '  $$\\lfloor S \\rfloor$$',
    '- 手数料はUS$1,000及びUS$2,000とする。',
].join('\n')

describe('数式', () => {
    it('文中の $…$ と、独立した $$…$$・```math を MathML で描く', () => {
        const html = renderDoc(parseLegal(SRC))
        expect(html).toContain('<span class="cd-math"><math>')
        expect(html).toContain('<mfrac>')
        expect(html.match(/class="cd-math-display"/g)?.length).toBe(2)
        expect(html).toContain('<div class="cd-math-block">')
    })

    it('金額の $ や日本語を含む範囲は数式にしない。\\$ は文字のまま', () => {
        expect(findMath('US$1,000及びUS$2,000とする。')).toEqual([])
        expect(findMath('$と$')).toEqual([])
        expect(findMath('\\$5 と $x$').map((m) => m.tex)).toEqual(['x'])
        expect(findMath('$\\text{月額} \\times 12$').map((m) => m.tex)).toEqual(['\\text{月額} \\times 12'])
        expect(findMath('$$a$$ と $b$').map((m) => [m.tex, m.display])).toEqual([['a', true], ['b', false]])
        expect(renderDoc(parseLegal(SRC))).toContain('US$1,000及びUS$2,000')
    })

    it('書けない数式は理由を返し、プレビューでは囲みに理由を出す', () => {
        expect(mathError('\\frac{1}{')).toMatch(/end of input/)
        expect(mathError('x^2')).toBeNull()
        const html = renderDoc(parseLegal('# a\n### b\n- 次の式\n  ```math\n  \\frac{1}{\n  ```\n'))
        expect(html).toContain('数式を描けません')
    })

    it('独立した数式の行を見分け、新旧対照表などの文字では［数式］と出す', () => {
        expect(displayLine('  $$x^2$$ ')).toBe('x^2')
        expect(displayLine('式は$$x$$です')).toBeNull()
        expect(blockLines('```math\nx^2\n```')).toEqual(['［数式］', '　x^2'])
    })

    it('Word では独立した数式を画像に、文中の数式は式の文字にする', async () => {
        const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207, 192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
        const figures = new Map([[mathKey('\\min\\left( S,\\ 1{,}000{,}000 \\right)'), { png, width: 120, height: 30 }], [mathKey('\\lfloor S \\rfloor'), { png, width: 40, height: 20 }]])
        const zip = unzipSync(new Uint8Array(await docToDocx(parseLegal(SRC), figures)))
        const xml = strFromU8(zip['word/document.xml'])
        expect(Object.keys(zip).filter((k) => k.startsWith('word/media/')).length).toBeGreaterThanOrEqual(1)
        expect(xml.match(/<pic:pic/g)?.length).toBe(2)
        expect(xml).toContain('S = \\frac{C \\times 2}{3}')
        const plain = strFromU8(unzipSync(new Uint8Array(await docToDocx(parseLegal(SRC))))['word/document.xml'])
        expect(plain).toContain('\\lfloor S \\rfloor')
    })
})
