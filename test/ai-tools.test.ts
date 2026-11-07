import { describe, expect, it, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { checkDoc, numberedText } from '../src/shared/doc-view'

const repos: { name: string; dir: string }[] = []
vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos, author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const { runTool } = await import('../src/main/ai-tools')

const DOC = `# 就業規則

## 総則

### 目的 {#目的}
- この規則は、従業員の就業に関する事項を定める。
- この規則に定めのない事項は、法令による。

### 試用期間
- 試用期間は3か月とする。
  - 正社員
- [[目的]]の規定により運用する。
`

describe('numberedText', () => {
    it('行番号と計算した番号を添える', () => {
        const t = numberedText(DOC).split('\n')
        expect(t[2]).toMatch(/^ ?3\| 〔第一章 総則〕## 総則$/)
        expect(t[4]).toContain('〔第1条〕### 目的 {#目的}')
        expect(t[6]).toContain('〔第1条第2項〕- この規則に定めのない')
        expect(t[10]).toContain('〔第2条第1項第一号〕  - 正社員')
    })
})

describe('checkDoc', () => {
    it('参照先のない条参照と本文のない条を見つける', () => {
        const issues = checkDoc('# 規程\n\n### 目的\n- [[ない]]による。\n\n### 空の条\n')
        expect(issues.map((i) => i.message)).toEqual([
            expect.stringContaining('[[ない]]'),
            expect.stringContaining('第2条に本文がありません'),
        ])
        expect(issues[0].line).toBe(4)
    })
    it('誤りがなければ空', () => {
        expect(checkDoc(DOC)).toEqual([])
    })
})

describe('ai-tools', () => {
    let dir = ''
    const ctx = { by: 'mcp' as const, changed: vi.fn() }
    beforeAll(async () => {
        dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-ai-'))
        await git.initRepo(dir)
        fs.writeFileSync(join(dir, '就業規則.md'), DOC.replace(/\n/g, '\r\n'))
        repos.push({ name: 'A社_規程', dir })
    })

    it('登録していないリポジトリは扱わない', async () => {
        await expect(runTool('list_docs', { repo: 'ほかの社' }, ctx)).rejects.toThrow('登録されていません')
    })

    it('edit_doc は1回だけ現れる本文を置き換え、CRLF の文書も LF の指定で直せる', async () => {
        await runTool('edit_doc', { repo: 'A社_規程', path: '就業規則.md', old_text: '試用期間は3か月とする。\n  - 正社員', new_text: '試用期間は2か月とする。\n  - 正社員' }, ctx)
        const src = fs.readFileSync(join(dir, '就業規則.md'), 'utf8')
        expect(src).toContain('試用期間は2か月とする。\r\n  - 正社員')
        expect(ctx.changed).toHaveBeenCalledWith(dir, '就業規則.md')
    })

    it('edit_doc は見つからない・複数ある本文を拒む', async () => {
        await expect(runTool('edit_doc', { repo: 'A社_規程', path: '就業規則.md', old_text: 'ない文', new_text: 'x' }, ctx)).rejects.toThrow('見つかりません')
        await expect(runTool('edit_doc', { repo: 'A社_規程', path: '就業規則.md', old_text: 'この規則', new_text: 'x' }, ctx)).rejects.toThrow('回現れます')
    })

    it('md 以外・隠しフォルダ・リポジトリの外には書き込まない', async () => {
        for (const path of ['.git/config.md', '.clausedown/readme.md', '../外.md', 'a/../../外.md', 'メモ.txt']) {
            await expect(runTool('write_doc', { repo: 'A社_規程', path, content: '# x' }, ctx)).rejects.toThrow('.md の文書だけ')
        }
    })

    it('入力の形が違えば実行しない', async () => {
        await expect(runTool('edit_doc', { repo: 'A社_規程', path: '就業規則.md' }, ctx)).rejects.toThrow('入力が正しくありません')
    })

    it('保存した版と作業フォルダを条単位で比べる', async () => {
        fs.writeFileSync(join(dir, '就業規則.md'), DOC)
        await git.saveVersion(dir, { message: '初版' })
        fs.writeFileSync(join(dir, '就業規則.md'), DOC.replace('3か月', '2か月'))
        const out = await runTool('compare_versions', { repo: 'A社_規程', path: '就業規則.md', from: '現行版' }, ctx)
        expect(out).toContain('改正前：\n（試用期間）\n第2条　試用期間は【3】か月とする。')
        expect(out).toContain('改正後：\n（試用期間）\n第2条　試用期間は【2】か月とする。')
        expect(out).not.toContain('第1条　')
    })
})
