import { describe, expect, it } from 'vitest'
import { stepUnits, trailsFor } from '../src/shared/article-history'

const doc = (...arts: string[]) => ['# 規程', ...arts].join('\n')
const v1 = doc('### 目的', '- 目的を定める。', '### 定義', '- 語を定める。')
const v2 = doc('### 目的', '- 目的を改めて定める。', '### 定義', '- 語を定める。')
const v3 = doc('### 総則', '- 前に足した条。', '### 目的', '- 目的を改めて定める。', '### 定義', '- 語を定める。', '### 雑則', '- 後に足した条。')

const kinds = (m: ReturnType<typeof trailsFor>, line: number) => m.get(line)?.events.map((e) => `${e.step}:${e.kind}`)

describe('条ごとの沿革', () => {
    const last = stepUnits([v1, v2, v3])
    const trails = trailsFor(last, v3)

    it('最初の版は制定、本文が変わった版は改正、足された版は新設', () => {
        expect(kinds(trails, 3)).toEqual(['0:enacted', '1:changed'])
        expect(kinds(trails, 1)).toEqual(['2:added'])
        expect(kinds(trails, 7)).toEqual(['2:added'])
    })

    it('前に条が足されて番号がずれただけなら改正に数えない', () => {
        expect(kinds(trails, 5)).toEqual(['0:enacted'])
    })

    it('最後の版から変えていなければ未施行の変更はない', () => {
        expect([...trails.values()].every((t) => !t.pending)).toBe(true)
    })

    it('今の文書で書き換えた条と足した条は未施行の変更あり', () => {
        const cur = v3.replace('語を定める。', '語を改める。') + '\n### 附加\n- 今足した条。'
        const t = trailsFor(last, cur)
        expect(t.get(5)?.pending).toBe(true)
        expect(t.get(3)?.pending).toBe(false)
        expect(t.get(9)).toEqual({ events: [], pending: true })
    })

    it('版がないときは、すべての条が未施行', () => {
        const t = trailsFor(null, v1)
        expect([...t.values()].every((x) => x.pending && !x.events.length)).toBe(true)
    })
})
