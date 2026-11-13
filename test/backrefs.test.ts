import { describe, expect, it } from 'vitest'
import { parseLegal } from '../src/shared/legal-parser'
import { backRefs } from '../src/shared/doc-view'

const src = [
    '# 規程',
    '### 目的 {#purpose}',
    '- この規程は、目的を定める。[[purpose]]の趣旨による。',
    '### 定義 {#def}',
    '- [[purpose]]に定めるもののほか、次のとおりとする。',
    '- 前項の規定は、[[purpose:1]]と[[purpose]]による。',
    '### 適用',
    '- [[def]]の語は、[[def]]のとおり読む。',
    '- 存在しない[[nothing]]',
].join('\n')

describe('参照元の一覧', () => {
    const doc = parseLegal(src)
    const refs = backRefs(src, doc)

    it('参照先の条ごとに、参照している行と位置をまとめる', () => {
        expect(refs.get(1)).toEqual([
            { line: 4, label: '第2条第1項', article: '第2条' },
            { line: 5, label: '第2条第2項', article: '第2条' },
        ])
        expect(refs.get(3)).toEqual([{ line: 7, label: '第3条第1項', article: '第3条' }])
    })

    it('自分の条からの参照と、参照先のない参照は数えない', () => {
        expect(refs.get(1)?.some((b) => b.line === 2)).toBe(false)
        expect([...refs.keys()].sort((a, b) => a - b)).toEqual([1, 3])
    })
})
