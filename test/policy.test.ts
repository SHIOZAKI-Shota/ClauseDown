import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { generateSshKey } from '../src/main/ssh-sig'
import { DEFAULT_SIGNING } from '../src/shared/signing'
import type { AppSettings } from '../src/shared/api'

const keys = { A: generateSshKey(), B: generateSshKey(), C: generateSshKey() }
type Who = keyof typeof keys
const state = {
    as: 'A' as Who,
    names: { A: '管理者A', B: '管理者B', C: '部外者C' } as Record<Who, string>,
    pins: {} as NonNullable<AppSettings['policyPins']>,
}
const settings = () => ({
    repos: [],
    author: { name: state.names[state.as], email: `${state.as}@example.com` },
    username: '',
    signing: { ...DEFAULT_SIGNING, commit: { ...DEFAULT_SIGNING.commit, mode: 'off' as const, key: { ...keys[state.as], createdAt: '' } } },
    policyPins: state.pins,
})

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => settings(),
    loadSecret: async (name: string) => (name === 'sign-ssh-key' ? keys[state.as].pem : null),
    saveSecret: async () => {},
    updateSettings: async (fn: (s: ReturnType<typeof settings>) => ReturnType<typeof settings>) => {
        state.pins = fn(settings()).policyPins ?? {}
    },
}))

const git = await import('../src/main/git')
const policy = await import('../src/main/policy')
const wf = await import('../src/main/workflow')
const { readRecordEntries, writeRecord } = await import('../src/main/records')

const person = (who: Who, withKey = true) => ({
    name: state.names[who],
    keys: withKey ? [{ publicKey: keys[who].publicKey, validFrom: '2020-01-01T00:00:00.000Z' }] : [],
})
const as = (who: Who) => {
    state.as = who
    signing().catch(() => {})
}
const signing = async () => (await import('../src/main/signing')).appKey()

async function repo() {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-policy-'))
    await git.initRepo(dir)
    await git.writeDoc(dir, '規程.md', '# 規程\n\n### 目的\n- 初版\n')
    await git.saveVersion(dir, { message: '初版' })
    return dir
}

describe('規則の署名（版の連鎖）', () => {
    let dir = ''
    beforeAll(async () => {
        dir = await repo()
        as('A')
        await wf.saveRules(dir, { requireApproval: true, approvers: ['田中'] })
    })

    it('署名なしの規則に署名すると第 1 版になり、承認者と管理者を引き継ぐ', async () => {
        expect((await policy.policyStatus(dir)).signed).toBe(false)
        const st = await policy.signLegacyRules(dir)
        expect(st.signed).toBe(true)
        expect(st.version).toBe(1)
        expect(st.genesis).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/)
        expect(st.draft.approvers.map((a) => a.name)).toEqual(['田中'])
        expect(st.draft.admins.map((a) => a.name)).toEqual(['管理者A'])
        expect(st.me.isAdmin).toBe(true)
        expect((await wf.getRules(dir)).approvers).toEqual(['田中'])
    })

    it('署名済みの規則を直接書き換える操作は拒否する', async () => {
        await expect(wf.saveRules(dir, { requireApproval: false, approvers: [] })).rejects.toThrow('署名済み')
    })

    it('管理者が提案した変更は採用され、部外者の提案は採用されない', async () => {
        const base = (await policy.policyStatus(dir)).draft
        await policy.proposePolicy(dir, { ...base, approvers: [person('A', false), { name: '山田', keys: [] }] })
        expect((await wf.getRules(dir)).approvers).toEqual(['管理者A', '山田'])

        as('C')
        const st = await policy.proposePolicy(dir, { ...base, requireApproval: false, approvers: [] })
        expect(st.version).toBe(2)
        expect(st.pending).toHaveLength(1)
        expect(st.pending[0]).toMatchObject({ have: 0, needed: 1, signedByMe: true })
        expect((await wf.getRules(dir)).requireApproval).toBe(true)
        as('A')
    })

    it('記録用ブランチの規則の中身を書き換えると、その版から先は採用しない', async () => {
        const [[file, raw]] = (await readRecordEntries<{ envelope: { payload: string } }>(dir, 'policy/')).filter(([f]) => f.startsWith('policy/000002-'))
        const doc = JSON.parse(Buffer.from(raw.envelope.payload, 'base64').toString())
        await writeRecord(dir, file, {
            ...raw,
            envelope: { ...raw.envelope, payload: Buffer.from(JSON.stringify({ ...doc, approvers: [] })).toString('base64') },
        })
        const st = await policy.policyStatus(dir)
        expect(st.warnings.map((w) => w.kind)).toContain('rollback')
        expect((await wf.getRules(dir)).approvers).toEqual(['管理者A', '山田'])
        await writeRecord(dir, file, raw)
        expect((await policy.policyStatus(dir)).warnings).toEqual([])
    })
})

describe('管理者の人数（閾値）と、新しい管理者の自己署名', () => {
    it('2 人の管理者が必要な規則は、2 人目の署名で確定する', async () => {
        const dir = await repo()
        as('A')
        await policy.signLegacyRules(dir)
        const base = (await policy.policyStatus(dir)).draft

        let st = await policy.proposePolicy(dir, { ...base, admins: [person('A'), person('B')], adminThreshold: 2 })
        expect(st.version).toBe(1)
        expect(st.pending[0]).toMatchObject({ version: 2, have: 1, needed: 1 })

        as('B')
        st = await policy.cosignPolicy(dir, st.pending[0].file)
        expect(st.version).toBe(2)
        expect(st.me.isAdmin).toBe(true)

        as('A')
        st = await policy.proposePolicy(dir, { ...st.draft, approvalThreshold: 2, approvers: [person('A'), person('B')] })
        expect(st.version).toBe(2)
        expect(st.pending[0]).toMatchObject({ have: 1, needed: 2 })
        as('B')
        st = await policy.cosignPolicy(dir, st.pending[0].file)
        expect(st.version).toBe(3)
        expect((await wf.getRules(dir)).approvalThreshold).toBe(2)
        as('A')
    })
})

describe('手元の記録による巻き戻し・差し替えの検知', () => {
    it('確認済みより古い版しかないと「巻き戻し」、起点が違うと「起点の変更」として、手元の内容を使う', async () => {
        const dir = await repo()
        as('A')
        await policy.signLegacyRules(dir)
        const key = Object.keys(state.pins).find((k) => state.pins[k].version === 1 && state.pins[k].doc.repo)!
        const pin = state.pins[key]
        state.pins[key] = { ...pin, version: 5, doc: { ...pin.doc, approvers: [{ name: '手元の承認者', keys: [] }] } }
        let st = await policy.policyStatus(dir)
        expect(st.warnings.map((w) => w.kind)).toContain('rollback')
        expect((await wf.getRules(dir)).approvers).toEqual(['手元の承認者'])
        await expect(policy.proposePolicy(dir, st.draft)).rejects.toThrow('起点の変更または巻き戻し')

        state.pins[key] = { ...pin, genesis: 'f'.repeat(64) }
        st = await policy.policyStatus(dir)
        expect(st.warnings.map((w) => w.kind)).toContain('genesisChanged')
        st = await policy.acceptGenesisChange(dir)
        expect(st.warnings).toEqual([])
    })
})

describe('承認者の鍵の固定', () => {
    it('規則に鍵を登録した承認者を、別の鍵で名乗った承認は署名ありと認めない', async () => {
        const dir = await repo()
        as('A')
        await policy.signLegacyRules(dir)
        const base = (await policy.policyStatus(dir)).draft
        await policy.proposePolicy(dir, { ...base, requireApproval: true, approvers: [person('B')] })
        const branch = await git.createBranch(dir, '改正')
        await git.writeDoc(dir, '規程.md', '# 規程\n\n### 目的\n- 改正\n')
        await git.saveVersion(dir, { message: '改正案' })

        await wf.addReview(dir, { branch, action: 'request', text: '確認を' })
        as('C')
        state.names.C = '管理者B'
        await wf.addReview(dir, { branch, action: 'approve', text: '' })
        state.names.C = '部外者C'
        as('A')
        let approve = (await wf.listReviews(dir)).find((e) => e.action === 'approve')!
        expect(approve.signed).toBe('unverified')

        as('B')
        await wf.addReview(dir, { branch, action: 'approve', text: '' })
        as('A')
        approve = (await wf.listReviews(dir)).filter((e) => e.action === 'approve').find((e) => e.signed === 'verified')!
        expect(approve.by).toBe('管理者B')
    })
})

describe('鍵一覧の書き出しと、確認待ち', () => {
    it('承認規則の鍵は有効期間付きで書き出し、署名待ちは管理者で未署名のときだけ確認待ちになる', async () => {
        const dir = await repo()
        as('A')
        await policy.signLegacyRules(dir)
        const { allowedSigners } = await import('../src/main/verify')
        const text = await allowedSigners(dir)
        expect(text).toMatch(new RegExp(`^管理者A namespaces="git",valid-after="\\d{14}Z" ${keys.A.publicKey.replace(/[+/]/g, '\\$&')}$`, 'm'))

        let st = await policy.policyStatus(dir)
        st = await policy.proposePolicy(dir, { ...st.draft, admins: [person('A'), person('B')], adminThreshold: 2 })
        as('B')
        st = await policy.cosignPolicy(dir, st.pending[0].file)
        as('A')
        st = await policy.proposePolicy(dir, { ...st.draft, approvalThreshold: 1 })
        const toSign = (x: typeof st) => x.pending.filter((p) => x.me.isAdmin && !p.signedByMe)
        expect(toSign(st)).toHaveLength(0)
        as('B')
        expect(toSign(await policy.policyStatus(dir))).toHaveLength(1)
        as('C')
        expect(toSign(await policy.policyStatus(dir))).toHaveLength(0)
        as('A')
    })
})

describe('必要な承認の人数', () => {
    it('2 人必要なら 1 人では反映できず、同じ人の 2 回は 1 人と数える', async () => {
        const { reviewStatus } = await import('../src/shared/review')
        const at = (m: number) => new Date(Date.UTC(2026, 10, 15, 0, m)).toISOString()
        const tip = 'a'.repeat(40)
        const base = { branch: '案/x', oid: tip, text: '', source: 'app' as const }
        const events = [
            { ...base, id: '1', action: 'request' as const, by: '依頼者', at: at(0) },
            { ...base, id: '2', action: 'approve' as const, by: '山田', at: at(1) },
            { ...base, id: '3', action: 'approve' as const, by: '山田', at: at(2) },
        ]
        const rules = { requireApproval: true, approvers: ['山田', '田中'], approvalThreshold: 2 }
        let st = reviewStatus(events, '案/x', tip, rules)
        expect([st.state, st.approvals, st.needed, st.canMerge]).toEqual(['requested', 1, 2, false])
        expect(st.reason).toContain('1／2')
        st = reviewStatus([...events, { ...base, id: '4', action: 'approve', by: '田中', at: at(3) }], '案/x', tip, rules)
        expect([st.state, st.approvals, st.canMerge]).toEqual(['approved', 2, true])
        st = reviewStatus(
            [...events, { ...base, id: '4', action: 'approve', by: '田中', at: at(3) }, { ...base, id: '5', action: 'changes', by: '山田', at: at(4) }],
            '案/x',
            tip,
            rules,
        )
        expect(st.state).toBe('changes')
    })
})

describe('鍵の交代', () => {
    it('旧い鍵に終了日時を付けても、交代前に旧い鍵で署名した承認は有効なまま', async () => {
        const dir = await repo()
        as('A')
        await policy.signLegacyRules(dir)
        let st = await policy.policyStatus(dir)
        await policy.proposePolicy(dir, { ...st.draft, requireApproval: true, approvers: [person('B')] })
        const branch = await git.createBranch(dir, '改正')
        await git.writeDoc(dir, '規程.md', '# 規程\n\n### 目的\n- 改正\n')
        await git.saveVersion(dir, { message: '改正案' })
        await wf.addReview(dir, { branch, action: 'request', text: '確認を' })
        as('B')
        await wf.addReview(dir, { branch, action: 'approve', text: '' })
        as('A')
        st = await policy.policyStatus(dir)
        const ended = {
            ...st.draft,
            approvers: [
                {
                    ...person('B'),
                    keys: [
                        { ...person('B').keys[0], validUntil: new Date().toISOString() },
                        { publicKey: keys.C.publicKey, validFrom: new Date().toISOString() },
                    ],
                },
            ],
        }
        await policy.proposePolicy(dir, ended)
        expect((await policy.policyStatus(dir)).version).toBe(3)
        const approve = (await wf.listReviews(dir)).find((e) => e.action === 'approve')!
        expect(approve.signed).toBe('verified')
    })
})
