import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { generateSshKey } from '../src/main/ssh-sig'
import { DEFAULT_SIGNING, type SigningSettings } from '../src/shared/signing'

const key = generateSshKey()
const who = { name: '依頼者' }
const state: { signing: SigningSettings } = {
    signing: { ...structuredClone(DEFAULT_SIGNING), commit: { ...DEFAULT_SIGNING.commit, key: { ...key, createdAt: '' } } },
}

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: who.name, email: 'a@example.com' }, username: '', signing: state.signing }),
    loadSecret: async () => key.pem,
    saveSecret: async () => {},
    updateSettings: async () => {},
}))

const git = await import('../src/main/git')
const wf = await import('../src/main/workflow')
const { readRecords, writeRecord } = await import('../src/main/records')
const { reviewStatus } = await import('../src/shared/review')

const DOC = '規程.md'

async function draftRepo() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-review-sign-'))
    await git.initRepo(dir)
    await git.writeDoc(dir, DOC, '# 規程\n\n### 目的\n- 初版\n')
    await git.saveVersion(dir, { message: '初版' })
    const branch = await git.createBranch(dir, '改正')
    await git.writeDoc(dir, DOC, '# 規程\n\n### 目的\n- 改正\n')
    await git.saveVersion(dir, { message: '改正案' })
    return { dir, branch }
}

describe('承認の署名', () => {
    let dir = ''
    let branch = ''
    beforeAll(async () => {
        ;({ dir, branch } = await draftRepo())
        who.name = '依頼者'
        await wf.addReview(dir, { branch, action: 'request', text: '確認をお願いします' })
        who.name = '承認者'
        await wf.addReview(dir, { branch, action: 'approve', text: '' })
    })

    it('依頼と承認の記録に in-toto の証明（DSSE）が付き、検証できる', async () => {
        const raw = await readRecords<{ action: string; attestation?: { payloadType: string } }>(dir, 'reviews/')
        expect(raw.every((e) => e.attestation?.payloadType === 'application/vnd.in-toto+json')).toBe(true)
        const events = await wf.listReviews(dir)
        expect(events.map((e) => [e.action, e.signed]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
            ['approve', 'verified'],
            ['request', 'verified'],
        ])
        const statement = JSON.parse(Buffer.from(raw.find((e) => e.action === 'approve')!.attestation!['payload' as never], 'base64').toString())
        expect(statement).toMatchObject({
            _type: 'https://in-toto.io/Statement/v1',
            predicateType: 'https://clausedown.app/attestation/review/v1',
            subject: [{ name: branch, digest: { gitCommit: await git.branchOid(dir, branch) } }],
            predicate: { action: 'approve', by: '承認者' },
        })
    })

    it('記録の版や承認者を書き換えると「署名なし」として扱う', async () => {
        const raw = await readRecords<{ id: string; action: string; oid: string; by: string }>(dir, 'reviews/')
        const approve = raw.find((e) => e.action === 'approve')!
        await writeRecord(dir, `reviews/${approve.id}.json`, { ...approve, by: '別の人' })
        expect((await wf.listReviews(dir)).find((e) => e.action === 'approve')!.signed).toBe('unverified')
        await writeRecord(dir, `reviews/${approve.id}.json`, { ...approve, oid: 'f'.repeat(40) })
        expect((await wf.listReviews(dir)).find((e) => e.action === 'approve')!.signed).toBe('unverified')
        await writeRecord(dir, `reviews/${approve.id}.json`, approve)
        expect((await wf.listReviews(dir)).find((e) => e.action === 'approve')!.signed).toBe('verified')
    })

    it('現行版に反映した版に承認者が残り、版そのものにも署名が入る', async () => {
        const main = await git.mainBranch(dir)
        await git.switchBranch(dir, main)
        await wf.adoptOrMerge(dir, { from: branch, into: main, choices: {}, message: '改正を反映' })
        const log = await git.log(dir, DOC)
        expect(log[0].message).toContain('Approved-by: 承認者 [signed]')
        const raw = execFileSync('git', ['cat-file', 'commit', main], { cwd: dir }).toString()
        expect(raw).toContain('gpgsig -----BEGIN SSH SIGNATURE-----')
    })
})

describe('署名のない承認を数えない規則', () => {
    it('規則が有効なら、署名のない承認では反映できない', async () => {
        const { dir, branch } = await draftRepo()
        await wf.saveRules(dir, { requireApproval: true, approvers: [], requireSignedApproval: true })
        expect((await wf.getRules(dir)).requireSignedApproval).toBe(true)
        state.signing = { ...state.signing, approvals: { sign: false } }
        try {
            who.name = '依頼者'
            await wf.addReview(dir, { branch, action: 'request', text: '確認を' })
            who.name = '承認者'
            await wf.addReview(dir, { branch, action: 'approve', text: '' })
            const events = await wf.listReviews(dir)
            const status = reviewStatus(events, branch, await git.branchOid(dir, branch), await wf.getRules(dir))
            expect(status.canMerge).toBe(false)
            expect(status.reason).toContain('署名のない承認')
            const main = await git.mainBranch(dir)
            await git.switchBranch(dir, main)
            await expect(wf.adoptOrMerge(dir, { from: branch, into: main, choices: {}, message: '反映' })).rejects.toThrow('署名のない承認')
        } finally {
            state.signing = { ...state.signing, approvals: { sign: true } }
        }
    })

    it('承認を必須にしていなければ、署名必須の規則は保存しない', async () => {
        const { dir } = await draftRepo()
        await wf.saveRules(dir, { requireApproval: false, approvers: [], requireSignedApproval: true })
        expect((await wf.getRules(dir)).requireSignedApproval).toBe(false)
    })
})
