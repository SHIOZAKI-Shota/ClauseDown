import { describe, expect, it } from 'vitest'
import { allFolders, findFolder, folderTree, groupByFolder, isUnder } from '../src/renderer/utils/folders'

const d = (path: string, title: string) => ({ path, title, changed: false })
const DOCS = [d('株式会社A/就業規則.md', '就業規則'), d('株式会社A/賃金規程.md', '賃金規程'), d('B商店/就業規則.md', '就業規則'), d('メモ.md', 'メモ')]

describe('groupByFolder', () => {
    it('クライアントごとにまとめ、フォルダなしは最後', () => {
        expect(groupByFolder(DOCS).map((g) => [g.folder, g.docs.length])).toEqual([
            ['B商店', 1],
            ['株式会社A', 2],
            ['', 1],
        ])
    })
    it('クライアント名と文書名を組み合わせて検索できる', () => {
        expect(groupByFolder(DOCS, 'A 賃金').map((g) => g.docs.map((x) => x.path))).toEqual([['株式会社A/賃金規程.md']])
        expect(groupByFolder(DOCS, '就業').map((g) => g.folder)).toEqual(['B商店', '株式会社A'])
        expect(groupByFolder(DOCS, 'B商店').flatMap((g) => g.docs).length).toBe(1)
    })
    it('既存のクライアント一覧', () => {
        expect(allFolders(DOCS)).toEqual(['B商店', '株式会社A'])
    })
})

describe('folderTree', () => {
    const docs = [d('laws/act/412/a.md', 'A'), d('laws/act/323/b.md', 'B'), d('laws/act/1000/c.md', 'C'), d('top.md', 'T')]
    const tree = folderTree(docs)

    it('階層ごとに文書の数を数える', () => {
        expect(tree.count).toBe(4)
        const act = findFolder(tree, 'laws/act')!
        expect(findFolder(tree, 'laws')!.count).toBe(3)
        expect(act.count).toBe(3)
        expect(findFolder(tree, 'laws/act/323')!.count).toBe(1)
    })

    it('名前を数字の順に並べる', () => {
        expect(findFolder(tree, 'laws/act')!.children.map((c) => c.name)).toEqual(['323', '412', '1000'])
    })

    it('無いパスは null、空のパスはルートを返す', () => {
        expect(findFolder(tree, 'laws/none')).toBeNull()
        expect(findFolder(tree, '')).toBe(tree)
    })

    it('isUnder はサブディレクトリの文書も含める', () => {
        expect(isUnder('laws/act/323/b.md', 'laws')).toBe(true)
        expect(isUnder('lawsuit/x.md', 'laws')).toBe(false)
        expect(isUnder('top.md', '')).toBe(true)
    })
})
