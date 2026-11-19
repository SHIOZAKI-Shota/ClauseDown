import { describe, expect, it } from 'vitest'
import { parseLegal } from '../src/shared/legal-parser'
import { computeScopes, hangOf, innermostBlock } from '../src/renderer/utils/scope-guides'

const SRC = [
    '# 規則',
    '',
    '::: cover',
    '表紙',
    '::: {center}',
    '中央',
    ':::',
    ':::',
    '',
    '## 総則',
    '',
    '### 目的',
    '- 本文',
    '  - 号',
    '',
    '    - 細分',
    '',
    '### 定義',
    '- 本文',
    '```',
    ':::',
    '```',
    '',
    '## 雑則',
    '',
    '### 施行',
    '- 本文',
    '',
    '',
].join('\n')

describe('範囲の線', () => {
    const scopes = computeScopes(parseLegal(SRC), SRC.split('\n'))

    it('章と条の範囲は次の見出しの前までで、後ろの空行を含めない', () => {
        expect(scopes.chapters).toEqual([
            { from: 9, to: 21 },
            { from: 23, to: 26 },
        ])
        expect(scopes.articles).toEqual([
            { from: 11, to: 15 },
            { from: 17, to: 21 },
            { from: 25, to: 26 },
        ])
    })

    it('::: の入れ子と深さを読み、コードの囲みの中の ::: は数えない', () => {
        expect(scopes.blocks).toEqual([
            { from: 2, to: 7, depth: 1 },
            { from: 4, to: 6, depth: 2 },
        ])
        expect(scopes.blockDepth.slice(2, 9)).toEqual([0, 1, 1, 2, 1, 0, 0])
        expect(scopes.blockDepth[20]).toBe(0)
        expect(innermostBlock(scopes.blocks, 5)?.from).toBe(4)
        expect(innermostBlock(scopes.blocks, 3)?.from).toBe(2)
        expect(innermostBlock(scopes.blocks, 9)).toBeUndefined()
    })

    it('字下げの段数を数え、空行は前後の浅いほうに合わせる', () => {
        expect(scopes.indent.slice(12, 17)).toEqual([0, 1, 1, 2, 0])
    })

    it('文書を読めていないときは章・条の範囲を出さない', () => {
        const none = computeScopes(null, SRC.split('\n'))
        expect(none.chapters).toEqual([])
        expect(none.articles).toEqual([])
        expect(none.blocks.length).toBe(2)
    })

    it('折り返した行は、行頭の字下げと箇条書きの記号の後ろにそろえる', () => {
        expect(hangOf('- 本文')).toBe(2)
        expect(hangOf('  - 号')).toBe(4)
        expect(hangOf('    - 細分')).toBe(6)
        expect(hangOf('1. 番号付き')).toBe(3)
        expect(hangOf('本文')).toBe(0)
        expect(hangOf('  | 表 |')).toBe(2)
        expect(hangOf('   ')).toBe(0)
    })
})
