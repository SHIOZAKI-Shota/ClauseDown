import { describe, expect, it } from 'vitest'
import { cleanSection, dissolveSection, groupRepos, placeRepo, renameSection, sectionNames } from '../src/shared/repo-sections'

const repos = [
    { dir: 'b1', section: 'B社' },
    { dir: 'x' },
    { dir: 'a1', section: 'A社' },
    { dir: 'b2', section: 'B社' },
    { dir: 'y', section: '  ' },
]
const dirs = (l: { dir: string }[]) => l.map((r) => r.dir)

describe('セクション', () => {
    it('セクションなしを先頭に、残りは最初に出てくる順にまとめる', () => {
        expect(groupRepos(repos).map((g) => [g.section, dirs(g.repos)])).toEqual([
            ['', ['x', 'y']],
            ['B社', ['b1', 'b2']],
            ['A社', ['a1']],
        ])
        expect(sectionNames(repos)).toEqual(['B社', 'A社'])
    })

    it('指定したリポジトリの前に入れ、そのセクションに移す', () => {
        const next = placeRepo(repos, 'x', { section: 'A社', before: 'a1' })
        expect(dirs(next)).toEqual(['b1', 'x', 'a1', 'b2', 'y'])
        expect(next[1]).toEqual({ dir: 'x', section: 'A社' })
    })

    it('前を指定しないときは、セクションの最後に入れる。誰もいないセクションなら末尾', () => {
        expect(dirs(placeRepo(repos, 'x', { section: 'B社' }))).toEqual(['b1', 'a1', 'b2', 'x', 'y'])
        expect(dirs(placeRepo(repos, 'a1', { section: 'C社' }))).toEqual(['b1', 'x', 'b2', 'y', 'a1'])
        expect(placeRepo(repos, 'b1', {})[0]).toEqual({ dir: 'x' })
        expect(placeRepo(repos, 'b1', {}).find((r) => r.dir === 'b1')).toEqual({ dir: 'b1' })
    })

    it('名前を変える・解く', () => {
        expect(renameSection(repos, 'B社', 'B株式会社').filter((r) => r.section === 'B株式会社').length).toBe(2)
        expect(dissolveSection(repos, 'B社').filter((r) => r.section).map((r) => r.dir)).toEqual(['a1', 'y'])
    })

    it('名前は空白を詰め、空なら undefined', () => {
        expect(cleanSection('  A　 社 ')).toBe('A 社')
        expect(cleanSection('   ')).toBeUndefined()
        expect(cleanSection('あ'.repeat(50))).toHaveLength(40)
    })
})
