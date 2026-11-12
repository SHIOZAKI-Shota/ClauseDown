import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import isogit from 'isomorphic-git'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const git = await import('../src/main/git')
const records = await import('../src/main/records')

describe('記録用ブランチ', () => {
    it('種類ごとのディレクトリに分けて書き、読み出せる', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-records-'))
        await git.initRepo(dir)
        await records.writeRecord(dir, `${records.RECORD.reviews}a.json`, { n: 1 })
        await records.writeRecord(dir, `${records.RECORD.reviews}b.json`, { n: 2 })
        await records.writeRecord(dir, `${records.RECORD.deliveries}c.json`, { n: 3 })
        await records.writeRecord(dir, records.RECORD.rules, { approvers: [] })

        const top = await isogit.readTree({ fs, dir, oid: await isogit.resolveRef({ fs, dir, ref: 'clausedown-records' }) })
        expect(top.tree.map((e) => [e.path, e.type])).toEqual([
            ['deliveries', 'tree'],
            ['reviews', 'tree'],
            ['settings', 'tree'],
        ])
        const reviews = await records.readRecords<{ n: number }>(dir, records.RECORD.reviews)
        expect(reviews.map((r) => r.n).sort((a, b) => a - b)).toEqual([1, 2])
        expect(await records.readRecord(dir, records.RECORD.rules)).toEqual({ approvers: [] })
        expect(fs.readdirSync(dir)).toEqual(['.git'])
    })

    it('おかしな名前では書かない', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-records-'))
        await git.initRepo(dir)
        for (const name of ['../x.json', 'reviews//x.json', 'reviews/x.txt', '/x.json']) {
            await expect(records.writeRecord(dir, name, {})).rejects.toThrow('記録の名前')
        }
    })
})
