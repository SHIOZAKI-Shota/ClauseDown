import { describe, expect, it } from 'vitest'
import { reviewStatus, type ReviewEvent } from '../src/shared/review'

let n = 0
const ev = (action: ReviewEvent['action'], by: string, oid = 'tip', extra: Partial<ReviewEvent> = {}): ReviewEvent => ({
    id: String(++n), branch: '案/x', action, oid, by, at: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, text: '', ...extra,
})
const RULES = { requireApproval: true, approvers: [] as string[] }

describe('reviewStatus', () => {
    it('依頼なしでは反映できない（承認必須のとき）', () => {
        const s = reviewStatus([], '案/x', 'tip', RULES)
        expect(s.state).toBe('none')
        expect(s.canMerge).toBe(false)
        expect(reviewStatus([], '案/x', 'tip', { ...RULES, requireApproval: false }).canMerge).toBe(true)
    })
    it('依頼者以外が承認すると反映できる。依頼者本人の承認は数えない', () => {
        const req = ev('request', '事務員A')
        expect(reviewStatus([req, ev('approve', '事務員A')], '案/x', 'tip', RULES).state).toBe('requested')
        const s = reviewStatus([req, ev('approve', '山田')], '案/x', 'tip', RULES)
        expect(s.state).toBe('approved')
        expect(s.canMerge).toBe(true)
    })
    it('承認後に版が増えたら承認し直し', () => {
        const s = reviewStatus([ev('request', 'A'), ev('approve', 'B', 'old')], '案/x', 'tip', RULES)
        expect(s.state).toBe('outdated')
        expect(s.canMerge).toBe(false)
    })
    it('承認者を決めていれば、その人だけが承認できる', () => {
        const rules = { requireApproval: true, approvers: ['山田'] }
        expect(reviewStatus([ev('request', 'A'), ev('approve', 'B')], '案/x', 'tip', rules).state).toBe('requested')
        expect(reviewStatus([ev('request', 'A'), ev('approve', '山田')], '案/x', 'tip', rules).state).toBe('approved')
    })
    it('修正依頼・取り下げ・再依頼', () => {
        const base = [ev('request', 'A'), ev('changes', 'B')]
        expect(reviewStatus(base, '案/x', 'tip', RULES).state).toBe('changes')
        expect(reviewStatus([...base, ev('withdraw', 'A')], '案/x', 'tip', RULES).state).toBe('none')
        expect(reviewStatus([...base, ev('request', 'A')], '案/x', 'tip', RULES).state).toBe('requested')
    })
    it('GitHub の承認は名前の照合をしない', () => {
        const s = reviewStatus([ev('request', 'A'), ev('approve', 'a-login', 'tip', { source: 'github' })], '案/x', 'tip', RULES)
        expect(s.state).toBe('approved')
    })
})

describe('承認者をユーザー名で決める', () => {
    const rules = { requireApproval: true, approvers: ['@Yamada', '佐藤'] }
    it('「@ユーザー名」は、アプリの記録のユーザー名ともリモートの承認とも照合する（大文字小文字は区別しない）', () => {
        const req = ev('request', 'A', 'tip', { byLogin: 'a-login' })
        expect(reviewStatus([req, ev('approve', '山田 太郎', 'tip', { byLogin: 'yamada' })], '案/x', 'tip', rules).state).toBe('approved')
        expect(reviewStatus([req, ev('approve', 'yamada', 'tip', { source: 'gitlab' })], '案/x', 'tip', rules).state).toBe('approved')
        expect(reviewStatus([req, ev('approve', 'suzuki', 'tip', { source: 'gitlab' })], '案/x', 'tip', rules).state).toBe('requested')
    })
    it('@ の無い登録は名前と照合する。名前が「@yamada」と同じでもユーザー名にはならない', () => {
        const req = ev('request', 'A')
        expect(reviewStatus([req, ev('approve', '佐藤')], '案/x', 'tip', rules).state).toBe('approved')
        expect(reviewStatus([req, ev('approve', 'Yamada')], '案/x', 'tip', rules).state).toBe('requested')
    })
    it('承認者を決めていなければ、依頼者本人の承認はユーザー名でも名前でも数えない', () => {
        const req = ev('request', '山田', 'tip', { byLogin: 'yamada' })
        expect(reviewStatus([req, ev('approve', '山田 太郎', 'tip', { byLogin: 'Yamada' })], '案/x', 'tip', RULES).state).toBe('requested')
        expect(reviewStatus([req, ev('approve', 'yamada', 'tip', { source: 'gitlab' })], '案/x', 'tip', RULES).state).toBe('requested')
        expect(reviewStatus([req, ev('approve', '佐藤', 'tip', { byLogin: 'sato' })], '案/x', 'tip', RULES).state).toBe('approved')
    })
})
