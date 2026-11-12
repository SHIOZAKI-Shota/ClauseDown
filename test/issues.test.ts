import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: '事務員A', email: 'a@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const wf = await import('../src/main/workflow')
const issues = await import('../src/main/issues')
const { writeRecord, RECORD } = await import('../src/main/records')

const DOC = '就業規則.md'
const state = async (dir: string) => Object.fromEntries((await issues.listIssues(dir)).map((i) => [i.n, i.state]))

describe('課題（ローカルのリポジトリ）', () => {
    let dir = ''
    beforeEach(async () => {
        dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-issues-'))
        await git.initRepo(dir)
        await git.writeDoc(dir, DOC, '# 就業規則\n### 休日\n- 日曜\n')
        await git.saveVersion(dir, { message: '初版' })
    })

    it('番号を 1 から振り、新しい順に並べる。題名は必須', async () => {
        await issues.createIssue(dir, { title: '休日の見直し', body: '第2条' })
        const b = await issues.createIssue(dir, { title: '退職の規定' })
        expect(b).toMatchObject({ n: 2, state: 'open', author: '事務員A', source: 'local' })
        expect((await issues.listIssues(dir)).map((i) => i.n)).toEqual([2, 1])
        await expect(issues.createIssue(dir, { title: '  ' })).rejects.toThrow('題名')
    })

    it('現行版で Closes #n を含む版を保存すると閉じる。改定案での保存では閉じない', async () => {
        await issues.createIssue(dir, { title: 'A' })
        await issues.createIssue(dir, { title: 'B' })
        await git.writeDoc(dir, DOC, '# 就業規則\n### 休日\n- 土曜及び日曜\n')
        const oid = await git.saveVersion(dir, { message: '休日を変更\n\nCloses #1' })
        expect(await issues.afterSave(dir, oid)).toEqual([1])
        const d = await git.createBranch(dir, '退職の改定')
        await git.writeDoc(dir, DOC, '# 就業規則\n### 休日\n- 土曜及び日曜\n### 退職\n- 届出\n')
        const draftOid = await git.saveVersion(dir, { message: '退職を追加 Closes #2' })
        expect(await issues.afterSave(dir, draftOid)).toEqual([])
        expect(await state(dir)).toEqual({ 1: 'closed', 2: 'open' })
        const one = await issues.issueDetail(dir, 1)
        expect(one.closedBy).toBe(oid)
        expect(one.versions).toEqual([expect.objectContaining({ oid, how: 'close' })])
        expect(d).toBeTruthy()
    })

    it('改定案を現行版に反映すると、メッセージの Closes と、画面で紐付けた課題が閉じる', async () => {
        for (const t of ['A', 'B', 'C']) await issues.createIssue(dir, { title: t })
        const d = await git.createBranch(dir, '改定')
        await git.writeDoc(dir, DOC, '# 就業規則\n### 休日\n- 土曜\n')
        await git.saveVersion(dir, { message: '休日を変更 Closes #1' })
        await issues.setBranchIssues(dir, d, [2])
        expect(await issues.branchIssues(dir, d)).toEqual([2])
        expect((await issues.issueDetail(dir, 2)).drafts).toEqual([d])
        const s = await wf.adoptOrMerge(dir, { from: d, into: 'main', choices: {}, message: '改定を反映' })
        expect(s.state).not.toBe('error')
        expect(await state(dir)).toEqual({ 1: 'closed', 2: 'closed', 3: 'open' })
    })

    it('画面から版を紐付け、版を指定して閉じ、開き直せる', async () => {
        await issues.createIssue(dir, { title: 'A' })
        const [head] = await git.log(dir)
        await issues.linkIssue(dir, 1, head.oid)
        await issues.linkIssue(dir, 1, head.oid)
        let d = await issues.issueDetail(dir, 1)
        expect(d.links).toHaveLength(1)
        expect(d.versions).toEqual([expect.objectContaining({ oid: head.oid, how: 'link', message: '初版' })])
        await issues.closeIssue(dir, 1, head.oid)
        d = await issues.issueDetail(dir, 1)
        expect(d).toMatchObject({ state: 'closed', closedBy: head.oid })
        expect(d.versions[0].how).toBe('close')
        await issues.updateIssue(dir, 1, { state: 'open' })
        d = await issues.issueDetail(dir, 1)
        expect(d.state).toBe('open')
        expect(d.closedBy).toBeUndefined()
        await expect(issues.linkIssue(dir, 1, 'x'.repeat(40))).rejects.toThrow()
    })

    it('コメントを書くと古い順に並び、書いた人が残る。空のコメントは書けない', async () => {
        await issues.createIssue(dir, { title: 'A' })
        await issues.commentIssue(dir, 1, '先方に確認中')
        await issues.commentIssue(dir, 1, '**11/20** の打合せで決定')
        await expect(issues.commentIssue(dir, 1, '\n ')).rejects.toThrow('コメントを書いて')
        const d = await issues.issueDetail(dir, 1)
        expect(d.comments.map((c) => [c.body, c.by, c.kind])).toEqual([
            ['先方に確認中', '事務員A', 'user'],
            ['**11/20** の打合せで決定', '事務員A', 'user'],
        ])
        expect((await issues.issueDetail(dir, 1)).comments).toHaveLength(2)
    })

    it('番号を振り直した課題でも、コメントは付いたまま', async () => {
        await writeRecord(dir, `${RECORD.issues}a.json`, { id: 'a', n: 1, title: '先', body: '', state: 'open', createdAt: '2026-01-01T00:00:00Z', links: [] })
        await writeRecord(dir, `${RECORD.issues}b.json`, { id: 'b', n: 1, title: '後', body: '', state: 'open', createdAt: '2026-01-02T00:00:00Z', links: [] })
        await writeRecord(dir, `${RECORD.issueComments}c.json`, { id: 'c', issue: 'b', body: '後の課題へのコメント', at: '2026-01-03T00:00:00Z' })
        expect((await issues.issueDetail(dir, 2)).comments.map((c) => c.body)).toEqual(['後の課題へのコメント'])
        expect((await issues.issueDetail(dir, 1)).comments).toEqual([])
    })

    it('ほかの PC で同じ番号ができたら、後で作ったほうを振り直す', async () => {
        await writeRecord(dir, `${RECORD.issues}a.json`, { id: 'a', n: 1, title: '先', body: '', state: 'open', createdAt: '2026-01-01T00:00:00Z', links: [] })
        await writeRecord(dir, `${RECORD.issues}b.json`, { id: 'b', n: 1, title: '後', body: '', state: 'open', createdAt: '2026-01-02T00:00:00Z', links: [] })
        const list = await issues.listIssues(dir)
        expect(list.map((i) => [i.n, i.title])).toEqual([
            [2, '後'],
            [1, '先'],
        ])
        expect(list[0].body).toContain('#1 から #2 に振り直しました')
        expect((await issues.listIssues(dir)).map((i) => i.n)).toEqual([2, 1])
    })
})
