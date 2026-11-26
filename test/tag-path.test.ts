import { describe, expect, it, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { fromTagPath, tagPath } from '../src/shared/tag-path'

vi.mock('../src/main/settings', () => ({
	getToken: async () => null,
	loadSettings: async () => ({ repos: [], author: { name: 'Alex', email: 'alex@example.com' }, username: '' }),
}))
const git = await import('../src/main/git')
const home = await import('../src/main/repo-home')

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'cd-tagpath-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('施行日の印に入れる文書のパス', () => {
	it('git の名前に使えない字を %XX にし、戻せる', () => {
		expect(tagPath('契約書/業務委託契約書.md')).toBe('契約書/業務委託契約書')
		expect(tagPath('Employee Handbook.md')).toBe('Employee%20Handbook')
		expect(tagPath('a..b/c:d?.md')).toBe('a%2E.b/c%3Ad%3F')
		for (const p of ['Employee Handbook', 'a..b/c:d?', '100% sure', 'x [draft]~^*', '.hidden/x.lock', '契約書/業務委託契約書'])
			expect(fromTagPath(tagPath(`${p}.md`))).toBe(p)
	})

	it('空白を含む文書名でも施行日を記録でき、一覧に出る', async () => {
		const dir = join(tmp, 'repo')
		fs.mkdirSync(dir)
		await git.initRepo(dir)
		await git.createDoc(dir, 'Employee Handbook.md', 'Employee Handbook')
		await git.saveVersion(dir, { message: 'First', effectiveDate: '2026-04-01', docPath: 'Employee Handbook.md' })
		const [eff] = await git.listEffective(dir, 'Employee Handbook.md')
		expect(eff?.date).toBe('2026-04-01')
		const all = await home.allEffective(dir)
		expect(all.map((e) => e.docPath)).toEqual(['Employee Handbook.md'])
	})
})
