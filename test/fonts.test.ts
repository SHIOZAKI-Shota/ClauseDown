import { describe, expect, it } from 'vitest'
import { canonicalFont, fontNames } from '../src/shared/fonts'
import { cssFont } from '../src/shared/prefs'
import { propsStyle } from '../src/shared/cd-prop'

describe('Windows と macOS で名前が違う書体', () => {
    it('macOS での名前を、設定に残す名前（Windows での名前）に直す', () => {
        expect(canonicalFont('游明朝体')).toBe('游明朝')
        expect(canonicalFont('YuMincho')).toBe('游明朝')
        expect(canonicalFont('BIZ UDGothic')).toBe('BIZ UDゴシック')
        expect(canonicalFont('Hiragino Mincho ProN')).toBe('ヒラギノ明朝 ProN')
        expect(canonicalFont('ＭＳ 明朝')).toBe('ＭＳ 明朝')
    })
    it('指定した名前を先頭にして、同じ書体の名前を並べる', () => {
        expect(fontNames('游明朝')).toEqual(['游明朝', '游明朝体', 'Yu Mincho', 'YuMincho'])
        expect(fontNames('游明朝体')[0]).toBe('游明朝体')
        expect(fontNames('メイリオ')).toEqual(['メイリオ'])
    })
    it('CSS には両方の OS の名前を重ねずに入れる', () => {
        expect(cssFont('游明朝')).toBe('"游明朝", "游明朝体", "Yu Mincho", "YuMincho", "MS Mincho", serif')
        expect(cssFont('BIZ UDゴシック', 'mono')).toBe('"BIZ UDゴシック", "BIZ UDGothic", "MS Gothic", monospace')
        expect(cssFont('メイリオ')).toBe('"メイリオ", "Yu Mincho", "YuMincho", "MS Mincho", serif')
        expect(propsStyle({ fontFamily: 'BIZ UDゴシック' })).toBe("font-family:'BIZ UDゴシック','BIZ UDGothic'")
    })
})
