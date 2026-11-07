import { describe, expect, it } from 'vitest'
import { applyResolutions, autoMerge, linesFor, merge3 } from '../src/shared/merge3'

const BASE = `# 就業規則
## 総則
### 目的
- 労働条件を定める。
### 休日
- 休日は日曜とする。
### 退職
- 届出による。
`

describe('3方向マージ', () => {
    it('別の条の変更は自動で両方残る', () => {
        const ours = BASE.replace('労働条件を定める。', '労働条件その他を定める。')
        const theirs = BASE.replace('届出による。', '30日前の届出による。')
        expect(autoMerge(BASE, ours, theirs)).toBe(
            BASE.replace('労働条件を定める。', '労働条件その他を定める。').replace('届出による。', '30日前の届出による。'),
        )
    })

    it('両方が別々の条を書き足しても、離れていれば自動で統合する', () => {
        const ours = BASE.replace('### 休日', '### 定義\n- 用語を定める。\n### 休日')
        const theirs = BASE + '### 懲戒\n- 別に定める。\n'
        const merged = autoMerge(BASE, ours, theirs)!
        expect(merged).toContain('### 定義')
        expect(merged).toContain('### 懲戒')
    })

    it('同じ箇所を両方が変えたら重なりになり、どの条かが分かる', () => {
        const ours = BASE.replace('日曜', '土曜及び日曜')
        const theirs = BASE.replace('日曜', '日曜及び祝日')
        const r = merge3(BASE, ours, theirs)
        expect(r.clean).toBe(false)
        expect(r.hunks).toHaveLength(1)
        expect(r.hunks[0]).toMatchObject({
            base: ['- 休日は日曜とする。'],
            ours: ['- 休日は土曜及び日曜とする。'],
            theirs: ['- 休日は日曜及び祝日とする。'],
            where: '第2条（休日）',
        })
        expect(applyResolutions(r, {})).toBeNull()
        expect(applyResolutions(r, { 0: { choice: 'custom', text: '- 休日は土曜、日曜及び祝日とする。' } })).toBe(
            BASE.replace('日曜とする', '土曜、日曜及び祝日とする'),
        )
        expect(applyResolutions(r, { 0: { choice: 'oursThenTheirs' } })).toContain('土曜及び日曜とする。\n- 休日は日曜及び祝日とする。')
    })

    it('改行コード（CRLF）の違いは重なりにしない', () => {
        const ours = BASE.replace(/\n/g, '\r\n').replace('日曜', '土曜及び日曜')
        expect(autoMerge(BASE, ours, BASE)).toBe(BASE.replace('日曜', '土曜及び日曜'))
    })

    it('両方が同じ変更をしたら重なりにしない', () => {
        const ours = BASE.replace('日曜', '土曜')
        expect(autoMerge(BASE, ours, ours)).toBe(ours)
    })

    it('同じ位置への別々の書き足しと、接した行の変更は重なりにする', () => {
        const ours = BASE.replace('### 退職', '### 定義\n- 甲\n### 退職')
        const theirs = BASE.replace('### 退職', '### 賞与\n- 乙\n### 退職')
        const r = merge3(BASE, ours, theirs)
        expect(r.hunks).toHaveLength(1)
        expect(r.hunks[0]).toMatchObject({ base: [], ours: ['### 定義', '- 甲'], theirs: ['### 賞与', '- 乙'], oursLine: 6 })
        expect(applyResolutions(r, { 0: { choice: 'theirsThenOurs' } })).toBe(
            BASE.replace('### 退職', '### 賞与\n- 乙\n### 定義\n- 甲\n### 退職'),
        )
        expect(merge3(BASE, BASE.replace('### 休日', '### 休暇'), BASE.replace('日曜', '土曜')).clean).toBe(false)
    })

    it('空の手入力は空行を残さない', () => {
        const r = merge3(BASE, BASE.replace('日曜', '土曜'), BASE.replace('日曜', '月曜'))
        expect(linesFor(r.hunks[0], 'custom', '')).toEqual([])
        expect(applyResolutions(r, { 0: { choice: 'custom', text: '' } })).toBe(BASE.replace('- 休日は日曜とする。\n', ''))
    })

    it('2 万行の文書で両側が散らばって変えても 1 秒かからない', () => {
        const lines: string[] = ['# 大きな法令']
        for (let i = 1; lines.length < 20000; i++) lines.push(`### 条${i}`, `- 第${i}条の本文である。`, '  - 号の一', '')
        const ours = [...lines]
        const theirs = [...lines]
        for (let i = 10; i < lines.length; i += 200) ours[i] += '（改）'
        for (let i = 110; i < lines.length; i += 200) theirs[i] += '（正）'
        const t = performance.now()
        const merged = autoMerge(lines.join('\n'), ours.join('\n'), theirs.join('\n'))
        expect(performance.now() - t).toBeLessThan(1000)
        expect(merged).toBe(lines.map((l, i) => (i % 200 === 10 ? `${l}（改）` : i % 200 === 110 ? `${l}（正）` : l)).join('\n'))
    })
})
