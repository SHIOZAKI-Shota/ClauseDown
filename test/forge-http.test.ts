import { describe, expect, it } from 'vitest'
import { paginate, pollDeviceToken, prNumber, type DeviceFlow } from '../src/main/forge-http'

const flow = (): DeviceFlow => ({ deviceCode: 'd', interval: 0, expiresAt: Date.now() + 60_000, clientId: 'c' })
const errors = { denied: 'denied', expired: 'expired', failed: (why: string) => `failed:${why}` }
const replies = (...list: Record<string, string | number>[]) => {
    let i = 0
    return async () => list[Math.min(i++, list.length - 1)]
}

describe('デバイスフローのポーリング', () => {
    it('待ちと slow_down のあいだは問い合わせを続け、トークンが来たら返す', async () => {
        const j = await pollDeviceToken(flow(), {
            request: replies({ error: 'authorization_pending' }, { error: 'slow_down', interval: 0 }, { access_token: 't' }),
            alive: () => true,
            errors,
        })
        expect(j.access_token).toBe('t')
    })

    it('拒否・期限切れ・その他のエラー・中止をそれぞれのメッセージにする', async () => {
        const run = (r: Record<string, string | number>, alive = true) => pollDeviceToken(flow(), { request: replies(r), alive: () => alive, errors })
        await expect(run({ error: 'access_denied' })).rejects.toThrow('denied')
        await expect(run({ error: 'expired_token' })).rejects.toThrow('expired')
        await expect(run({ error: 'boom', error_description: '壊れた' })).rejects.toThrow('failed:壊れた')
        await expect(run({ access_token: 't' }, false)).rejects.toThrow()
        await expect(pollDeviceToken({ ...flow(), expiresAt: 0 }, { request: replies({ access_token: 't' }), alive: () => true, errors })).rejects.toThrow(
            'expired',
        )
    })
})

describe('GitHub・GitLab の共通処理', () => {
    it('100 件に満たないページで止め、上限のページ数を超えない', async () => {
        const pages: number[] = []
        const got = await paginate(async (p) => (pages.push(p), p < 3 ? Array(100).fill(p) : [p]), 10)
        expect(got).toHaveLength(201)
        expect(pages).toEqual([1, 2, 3])
        const capped: number[] = []
        await paginate(async (p) => (capped.push(p), Array(100).fill(p)), 2)
        expect(capped).toEqual([1, 2])
    })

    it('番号は正の整数だけを通す', () => {
        expect(prNumber(7)).toBe(7)
        for (const bad of [0, -1, 1.5, '7', null]) expect(() => prNumber(bad)).toThrow()
    })
})
