import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { startGitServer } from './git-server'

const who = { name: '事務員A' }
vi.mock('../src/main/settings', () => ({
    getToken: async () => 'dummy',
    loadSettings: async () => ({ repos: [], author: { name: who.name, email: 'a@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const wf = await import('../src/main/workflow')
const sch = await import('../src/main/schedule')
const { parseGitHub } = await import('../src/main/github')

let root = ''
let url = ''
let close = () => {}
beforeAll(async () => {
    ;({ root, url, close } = await startGitServer())
})
afterAll(() => close())

const DOC = '株式会社A/就業規則.md'
const V1 = '# 就業規則\n\n### 目的\n- 初版\n\n### 休日\n- 日曜\n'
const stub = (label: string) => async () => new TextEncoder().encode(label)
const builders = {
    docPdf: stub('pdf'),
    docDocx: stub('docx'),
    cmpPdf: async (o: string, n: string) => new TextEncoder().encode(`cmp:${o.length}:${n.length}`),
    cmpDocx: stub('cmpdocx'),
}

describe('parseGitHub', () => {
    it('GitHub の URL だけを読み取る', () => {
        expect(parseGitHub('https://github.com/office/kitei.git')).toEqual({ owner: 'office', repo: 'kitei' })
        expect(parseGitHub('git@github.com:office/kitei.git')).toEqual({ owner: 'office', repo: 'kitei' })
        expect(parseGitHub('https://gitlab.com/office/kitei.git')).toBeNull()
    })
})

describe('施行版・確認依頼・納品', () => {
    const pcA = () => join(root, 'pcA')
    const pcB = () => join(root, 'pcB')
    let v1 = ''
    let draft = ''

    it('施行版の一覧と、あとから施行日を付ける・外す', async () => {
        await git.cloneRepo(url, pcA())
        await git.writeDoc(pcA(), DOC, V1)
        v1 = await git.saveVersion(pcA(), { message: '初版', effectiveDate: '2025-04-01', docPath: DOC })
        await git.push(pcA())
        await git.addEffective(pcA(), DOC, v1, '2025-10-01')
        const list = await git.listEffective(pcA(), DOC)
        expect(list.map((e) => e.date)).toEqual(['2025-10-01', '2025-04-01'])
        expect(list[0]).toMatchObject({ oid: v1, message: '初版' })
        await git.removeEffective(pcA(), DOC, '2025-10-01')
        expect((await git.listEffective(pcA(), DOC)).map((e) => e.date)).toEqual(['2025-04-01'])
        await expect(git.addEffective(pcA(), 'ない.md', v1, '2025-01-01')).rejects.toThrow('この文書がありません')
    })

    it('決まり（承認必須）は記録用ブランチで共有され、改定案の一覧には出ない', async () => {
        await wf.saveRules(pcA(), { requireApproval: true, approvers: [' 山田 ', '山田'] })
        await git.cloneRepo(url, pcB())
        expect(await wf.getRules(pcB())).toEqual({ requireApproval: true, approvers: ['山田'] })
        expect((await git.listBranches(pcB())).map((b) => b.label)).toEqual(['現行版'])
    })

    it('承認がないと反映できない。承認者が承認すると反映できる', async () => {
        who.name = '事務員A'
        await git.writeDoc(pcA(), DOC, V1.replace('日曜', '土曜及び日曜'))
        draft = await git.createBranch(pcA(), '2026年改定')
        await git.saveVersion(pcA(), { message: '休日を変更' })
        const input = { from: draft, into: 'main', choices: {}, message: '反映', deleteAfter: true }
        await expect(wf.adoptOrMerge(pcA(), input)).rejects.toThrow('確認と承認が必要')
        await expect(wf.addReview(pcA(), { branch: draft, action: 'approve', text: '' })).rejects.toThrow('確認依頼が出ていません')

        await wf.addReview(pcA(), { branch: draft, action: 'request', text: '' })
        await git.push(pcA())

        await git.sync(pcB())
        who.name = '事務員B'
        await wf.addReview(pcB(), { branch: draft, action: 'approve', text: '' })
        who.name = '山田'
        await wf.addReview(pcB(), { branch: draft, action: 'approve', text: 'OK です' })

        who.name = '事務員A'
        await git.sync(pcA())
        const events = await wf.listReviews(pcA())
        expect(events.filter((e) => e.branch === draft).map((e) => `${e.action}:${e.by}`)).toEqual(
            expect.arrayContaining(['request:事務員A', 'approve:事務員B', 'approve:山田']),
        )
        expect(await wf.adoptOrMerge(pcA(), { ...input, effectiveDate: '2026-04-01' })).toEqual({ state: 'upToDate' })
        expect(await git.readDoc(pcA(), DOC)).toContain('土曜及び日曜')
        expect((await git.listEffective(pcA(), DOC)).map((e) => e.date)).toEqual(['2026-04-01', '2025-04-01'])
    })

    it('承認後に版を足したら承認し直し', async () => {
        who.name = '事務員A'
        const d2 = await git.createBranch(pcA(), '追加改定')
        await git.writeDoc(pcA(), DOC, V1 + '\n### 退職\n- 届出\n')
        await git.saveVersion(pcA(), { message: '退職を追加' })
        await wf.addReview(pcA(), { branch: d2, action: 'request', text: '' })
        who.name = '山田'
        await wf.addReview(pcA(), { branch: d2, action: 'approve', text: '' })
        who.name = '事務員A'
        await git.writeDoc(pcA(), DOC, V1 + '\n### 退職\n- 届出による\n')
        await git.saveVersion(pcA(), { message: '文言修正' })
        await expect(wf.adoptOrMerge(pcA(), { from: d2, into: 'main', choices: {}, message: 'x' })).rejects.toThrow('承認したあとで')
    })

    it('納品一式を作って記録する', async () => {
        who.name = '事務員A'
        const out = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-out-'))
        const [now, prev] = await git.listEffective(pcA(), DOC)
        const rec = await wf.deliver(
            pcA(),
            {
                docPath: DOC,
                oid: now.oid,
                baseOid: prev.oid,
                effectiveDate: now.date,
                to: '株式会社A 人事部',
                memo: '令和8年4月改定分',
                items: ['docPdf', 'docDocx', 'cmpPdf', 'cmpDocx'],
                publishRelease: true,
            },
            out,
            builders,
        )
        expect(rec.files).toEqual(['就業規則.pdf', '就業規則.docx', '就業規則 新旧対照表.pdf', '就業規則 新旧対照表.docx'])
        expect(rec.folder).toMatch(/_株式会社A_就業規則_納品$/)
        expect(fs.readFileSync(join(rec.folder, '就業規則 新旧対照表.docx'), 'utf8')).toBe('cmpdocx')
        expect(rec.releaseUrl).toBeUndefined()
        await git.push(pcA())
        await git.sync(pcB())
        const list = await wf.listDeliveries(pcB(), DOC)
        expect(list.map((d) => [d.to, d.effectiveDate, d.by])).toEqual([['株式会社A 人事部', '2026-04-01', '事務員A']])
    })

    it('2台で同時に記録しても両方残る', async () => {
        who.name = '事務員A'
        await wf.saveRules(pcA(), { requireApproval: false, approvers: [] })
        who.name = '山田'
        const out = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-out-'))
        const [now] = await git.listEffective(pcB(), DOC)
        await wf.deliver(pcB(), { docPath: DOC, oid: now.oid, to: 'B社', memo: '', items: ['docPdf'], publishRelease: false }, out, builders)
        await git.sync(pcB())
        await git.push(pcB())
        await git.sync(pcA())
        expect((await wf.listDeliveries(pcA(), DOC)).length).toBe(2)
        expect(await wf.getRules(pcA())).toEqual({ requireApproval: false, approvers: [] })
    })

    it('期日：足す・直す・済み・消すが、もう一方の PC に届く。消したものは戻らない', async () => {
        who.name = '事務員A'
        const a = await sch.saveEvent(pcA(), { kind: 'notify', docPath: DOC, date: '2026-12-01' })
        const gone = await sch.saveEvent(pcA(), { kind: 'submit', docPath: '', date: '2026-12-10' })
        await git.push(pcA())
        await git.sync(pcB())
        expect((await sch.listEvents(pcB())).map((e) => e.id).sort()).toEqual([a.id, gone.id].sort())

        await sch.deleteEvent(pcA(), gone.id)
        who.name = '山田'
        const b = await sch.saveEvent(pcB(), { kind: 'start', docPath: '', date: '2027-01-01' })
        await sch.setEventDone(pcB(), a.id, '2026-12-01', true)
        await git.push(pcA())
        await git.sync(pcB())
        await git.push(pcB())
        await git.sync(pcA())
        for (const pc of [pcA(), pcB()]) {
            const list = await sch.listEvents(pc)
            expect(list.map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
            expect(list.find((e) => e.id === a.id)?.done).toEqual(['2026-12-01'])
        }
        expect((await git.listBranches(pcA())).map((x) => x.name)).not.toContain('clausedown-records')
    })

    it('外した施行日は、もう一方の PC からも外れる。まだ送っていない施行日は残る', async () => {
        const dates = async (pc: string) => (await git.listEffective(pc, DOC)).map((e) => e.date)
        await git.addEffective(pcA(), DOC, v1, '2030-01-01')
        await git.sync(pcB())
        expect(await dates(pcB())).toContain('2030-01-01')

        await git.tagEffective(pcB(), [DOC], '2031-01-01', v1)
        await git.removeEffective(pcA(), DOC, '2030-01-01')
        await git.sync(pcB())
        expect(await dates(pcB())).not.toContain('2030-01-01')
        expect(await dates(pcB())).toContain('2031-01-01')
        await git.push(pcB())
        await git.sync(pcA())
        expect(await dates(pcA())).toContain('2031-01-01')
    })
})
