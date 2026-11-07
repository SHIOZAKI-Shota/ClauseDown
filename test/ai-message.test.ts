import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))
const asked: { system: string; prompt: string }[] = []
vi.mock('../src/main/ai-agent', () => ({
    aiAsk: async (system: string, prompt: string) => {
        asked.push({ system, prompt })
        return '「第1条 期間を二年に変更」。\n補足の行'
    },
}))

const git = await import('../src/main/git')
const { suggestVersionMessage } = await import('../src/main/ai-message')

describe('版の説明を AI で下書きする', () => {
    it('保存していない変更を、消した文字と足した文字の印付きで渡し、1 行にして返す', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-aimsg-'))
        await git.initRepo(dir)
        await git.writeDoc(dir, 'a.md', '# 規程\n\n### 期間\n- 期間は一年とする。\n')
        await git.saveVersion(dir, { message: '初版' })
        await expect(suggestVersionMessage(dir)).rejects.toThrow('変更がありません')
        await git.writeDoc(dir, 'a.md', '# 規程\n\n### 期間\n- 期間は二年とする。\n')
        await git.writeDoc(dir, 'b.md', '# 新しい規程\n\n### 目的\n- 定める。\n')
        expect(await suggestVersionMessage(dir)).toBe('第1条 期間を二年に変更')
        const { prompt } = asked.at(-1)!
        expect(prompt).toContain('[-一-]{+二+}')
        expect(prompt).toContain('■ 新しい規程（新しい文書）')
    })
})
