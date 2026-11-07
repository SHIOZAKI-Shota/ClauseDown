import { describe, expect, it } from 'vitest'
import { parseLegal } from '../src/shared/legal-parser'
import { hintsOf, positionLabel } from '../src/renderer/utils/legal-editor'

const SRC = `# 規則
## 総則
### 目的
- 本文
- 第2項
  - 号
### 定義
- 本文
`

describe('エディタの番号表示', () => {
    const doc = parseLegal(SRC)
    it('章・条・第2項以降・号に番号を出す（第1項は条番号があるので出さない）', () => {
        expect(hintsOf(doc).map((h) => `${h.line}:${h.label}`)).toEqual(['1:第一章', '2:第1条', '4:２', '5:一', '6:第2条'])
    })
    it('カーソルの位置を「第1条第2項 一」のように表す', () => {
        expect(positionLabel(doc, 3)).toBe('第1条第1項')
        expect(positionLabel(doc, 5)).toBe('第1条第2項 一')
        expect(positionLabel(doc, 7)).toBe('第2条第1項')
        expect(positionLabel(doc, 1)).toBe('第一章')
    })
})
