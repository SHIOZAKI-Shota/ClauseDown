import { describe, expect, it } from 'vitest'
import { ignoredRanges, proofread } from '../src/main/proofread-core'

const at = (src: string, word: string) => src.indexOf(word)

describe('校閲', () => {
    it('助詞の連続・ら抜き・用字を、本文の位置で返す', async () => {
        const src = '# 規則\n\n### 目的\n- 甲は乙は合意する。\n- 期限までに来れる者に限る。\n- 甲または乙は、但し書きに従う。\n'
        const issues = await proofread(src)
        const rules = issues.map((i) => i.rule)
        expect(rules).toContain('同じ助詞の連続')
        expect(rules).toContain('ら抜き言葉')
        const yoji = issues.filter((i) => i.rule === '用字')
        expect(yoji.map((i) => src.slice(i.from, i.to))).toEqual(['または', '但し'])
        expect(yoji[0].from).toBe(at(src, 'または'))
        expect(yoji[0].message).toContain('又は')
    }, 60_000)

    it('設定・条参照・属性・コードの囲みの中は指摘しない', async () => {
        const src = '# 規則\n<!-- clausedown\narticle: { title: または }\n-->\n### 目的 {#または}\n- [[または]]に従う。\n```\nまたは\n```\n'
        expect(await proofread(src)).toEqual([])
    }, 60_000)

    it('長すぎる文書や文字列でないものは見ない', async () => {
        expect(await proofread('または'.repeat(70_000))).toEqual([])
        expect(await proofread(123)).toEqual([])
    })

    it('除外する範囲を拾う', () => {
        const src = '- a [[x]] b {#y}\n::: {size=9pt}\n'
        expect(ignoredRanges(src).map(([a, b]) => src.slice(a, b))).toEqual(['[[x]]', '{#y}', '{size=9pt}', '::: {size=9pt}'])
    })
})
