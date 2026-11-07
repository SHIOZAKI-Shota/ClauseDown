import { describe, expect, it } from 'vitest'
import { layoutGraph } from '../src/renderer/utils/graph'

describe('layoutGraph', () => {
    it('一本道は全部0列目', () => {
        const g = layoutGraph([
            { oid: 'c', parents: ['b'] },
            { oid: 'b', parents: ['a'] },
            { oid: 'a', parents: [] },
        ])
        expect(g.lanes).toEqual([0, 0, 0])
        expect(g.width).toBe(1)
        expect(g.edges.length).toBe(2)
    })

    it('分岐して合流する履歴は2列になり、合流後は1列に戻る', () => {
        const g = layoutGraph([
            { oid: 'm', parents: ['x', 'y'] },
            { oid: 'x', parents: ['a'] },
            { oid: 'y', parents: ['a'] },
            { oid: 'a', parents: ['z'] },
            { oid: 'z', parents: [] },
        ])
        expect(g.lanes).toEqual([0, 0, 1, 0, 0])
        expect(g.width).toBe(2)
        const yToA = g.edges.find((e) => e.fromRow === 2)!
        expect(yToA).toMatchObject({ fromLane: 1, toLane: 0, curve: 'bottom' })
    })
})

describe('現行版の幹を左端に置く', () => {
    it('新しい改定案が上にあっても、現行版は0列目・改定案は1列目', () => {
        const g = layoutGraph([
            { oid: 'd2', parents: ['m'] },
            { oid: 'm', parents: ['b', 'd1'], onMain: true },
            { oid: 'd1', parents: ['b'] },
            { oid: 'b', parents: [], onMain: true },
        ])
        expect(g.lanes).toEqual([1, 0, 1, 0])
        expect(g.edges.find((e) => e.fromRow === 0)).toMatchObject({ toLane: 0 })
        expect(g.edges.find((e) => e.fromRow === 1 && e.toRow === 2)).toMatchObject({ toLane: 1, curve: 'top' })
    })
})
