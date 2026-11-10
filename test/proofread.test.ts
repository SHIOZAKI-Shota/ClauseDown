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

    it('規則ごとに切れる。切った規則の指摘は出ない', async () => {
        const src = '- 甲は乙は、または代理人により合意する。\n'
        const on = (await proofread(src)).map((i) => i.rule)
        expect(on).toEqual(expect.arrayContaining(['同じ助詞の連続', '用字']))
        const off = (await proofread(src, { rules: { prh: false } })).map((i) => i.rule)
        expect(off).toContain('同じ助詞の連続')
        expect(off).not.toContain('用字')
    }, 60_000)

    it('「同じ助詞の連続」で許す助詞を変えられる', async () => {
        const src = '- 甲は乙は合意する。\n'
        expect((await proofread(src)).some((i) => i.rule === '同じ助詞の連続')).toBe(true)
        expect((await proofread(src, { joshiAllow: ['は'] })).some((i) => i.rule === '同じ助詞の連続')).toBe(false)
    }, 60_000)

    it('追加した規則：よくある誤用・半角カナ・読点の多い文。冗長な表現は初めは切ってある', async () => {
        const src = '- 前条の規定を適応する。\n- ｶﾀｶﾅで書く。\n- 甲は、乙に対し、丙と、丁と、戊と、己と、庚とともに、通知する。\n- 甲は解除することができる。\n'
        const rules = (await proofread(src)).map((i) => i.rule)
        expect(rules).toEqual(expect.arrayContaining(['よくある誤用', '半角カナ', '読点の多い文']))
        expect(rules).not.toContain('冗長な表現')
        expect((await proofread(src, { rules: { 'ja-no-redundant-expression': true } })).map((i) => i.rule)).toContain('冗長な表現')
    }, 60_000)

    it('組み込みの辞書に、ほかの辞書を足せる', async () => {
        const src = '- 子供に配る。\n'
        expect(await proofread(src)).toEqual([])
        const r = await proofread(src, { dictionaries: ['version: 1\nrules:\n  - expected: 子ども\n    pattern: 子供\n'] })
        expect(r.map((i) => [i.rule, src.slice(i.from, i.to)])).toEqual([['用字', '子供']])
    }, 60_000)

    it('法令の用字：内閣法制局の決定の言い換え', async () => {
        const src = '- 虞がある場合は、捺印し、斡旋を受ける。\n- 従って、繋留する。\n- 本則に定めるものの外、規則による。\n'
        const hits = (await proofread(src)).filter((i) => i.rule === '法令の用字').map((i) => src.slice(i.from, i.to))
        expect(hits).toEqual(['虞', '捺印', '斡旋', '従って、', '繋留', 'ものの外'])
    }, 60_000)

    it('法令の送り仮名：名詞のときだけ指摘し、動詞の連用形は指摘しない', async () => {
        const src = '- 取り消しの請求は、手続きに従う。\n- 甲は、これを取り消し、乙に通知する。\n- 代金を払い渡し又は供託する。\n- 支払いを受ける。\n- 届け出る。届け出をする。\n'
        const hits = (await proofread(src)).filter((i) => i.rule === '法令の送り仮名').map((i) => src.slice(i.from, i.to))
        expect(hits).toEqual(['取り消し', '手続き', '支払い', '届け出'])
    }, 60_000)

    it('法令の用字・送り仮名は規則ごとに切れる', async () => {
        const src = '- 捺印し、取り消しの請求をする。\n'
        const rules = (await proofread(src, { rules: { 'legal-okurigana': false } })).map((i) => i.rule)
        expect(rules).toContain('法令の用字')
        expect(rules).not.toContain('法令の送り仮名')
    }, 60_000)
})
