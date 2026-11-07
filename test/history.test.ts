import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({ getToken: async () => null, loadSettings: async () => ({ author: { name: 't', email: 't@x' } }) }))
const g = await import('../src/main/git')

describe('文書ごとの履歴', () => {
    it('統合の版も出て、親が2つになる。今いる案と現行版の幹が分かる', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-hist-'))
        await g.initRepo(dir)
        await g.writeDoc(dir, 'a.md', '# a\n### x\n- 1\n')
        await g.saveVersion(dir, { message: 'base' })
        await g.createBranch(dir, 'draft')
        await g.writeDoc(dir, 'a.md', '# a\n### x\n- 2\n')
        await g.saveVersion(dir, { message: 'draft change' })
        await g.switchBranch(dir, 'main')
        await g.writeDoc(dir, 'b.md', '# b\n')
        await g.saveVersion(dir, { message: 'main other' })
        await g.mergeBranch(dir, { from: '案/draft', into: 'main', choices: {}, message: 'merge' })
        await g.createBranch(dir, 'next')
        await g.writeDoc(dir, 'a.md', '# a\n### x\n- 3\n')
        await g.saveVersion(dir, { message: 'next change' })

        const log = await g.log(dir, 'a.md', true)
        const by = Object.fromEntries(log.map((c) => [c.message, c]))
        expect(log.map((c) => c.message)).toEqual(['next change', 'merge', 'draft change', 'base'])
        expect(by.merge.parents).toEqual([by.base.oid, by['draft change'].oid])
        expect(by['next change']).toMatchObject({ head: true, onCurrent: true, onMain: false, branches: ['next'] })
        expect(by.merge).toMatchObject({ onCurrent: true, onMain: true, branches: ['現行版'] })
        expect(by['draft change']).toMatchObject({ onCurrent: false, onMain: false })
        expect(by['main other']).toBeUndefined()

        await g.switchBranch(dir, 'main')
        await g.createBranch(dir, 'other')
        await g.writeDoc(dir, 'b.md', '# b2\n')
        await g.saveVersion(dir, { message: 'other change' })
        const filtered = await g.log(dir, 'a.md', true)
        expect(filtered.flatMap((c) => c.branches)).not.toContain('other')
        expect((await g.log(dir, undefined, true)).flatMap((c) => c.branches)).toContain('other')
    })
})
