import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import { startGitServer } from './git-server'
import { prOf } from '../src/shared/review'
import { cspFor, inlineScriptHashes } from '../src/main/csp'

const repos: { name: string; dir: string }[] = []
vi.mock('../src/main/settings', () => ({
    getToken: async () => 'SECRET-TOKEN',
    listCredentials: async () => ({}),
    loadSettings: async () => ({ repos, author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
}))
const git = await import('../src/main/git')
const base = await import('../src/main/git-base')
const wf = await import('../src/main/workflow')
const records = await import('../src/main/records')
const tools = await import('../src/main/ai-tools')
const gh = await import('../src/main/github')
const gl = await import('../src/main/gitlab')

let root = ''
let url = ''
let close = () => {}
beforeAll(async () => {
    ;({ root, url, close } = await startGitServer())
})
afterAll(() => close())

const V1 = '# 規程\n\n### 目的\n- 初版\n'

describe('悪意のあるフォルダ・リポジトリ', () => {
    it('.git/config の http.corsProxy に、認証付きの通信を送らない', async () => {
        const dir = join(root, 'proxy-victim')
        await git.cloneRepo(url, dir)
        await git.writeDoc(dir, '規程.md', V1)
        await git.saveVersion(dir, { message: '初版' })

        const seen: { url: string; auth?: string }[] = []
        const evil = http.createServer((req, res) => {
            seen.push({ url: req.url ?? '', auth: req.headers.authorization })
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="x"' })
            res.end()
        })
        await new Promise<void>((r) => evil.listen(0, '127.0.0.1', () => r()))
        const port = (evil.address() as { port: number }).port
        fs.appendFileSync(join(dir, '.git', 'config'), `\n[http]\n\tcorsProxy = http://127.0.0.1:${port}\n`)

        vi.stubEnv('CLAUSEDOWN_LOOPBACK_BASE', 'https://github.com')
        try {
            expect(((await base.onAuth(url, {} as never)) as { password?: string }).password).toBe('SECRET-TOKEN')
            await git.sync(dir).catch(() => {})
            await git.push(dir).catch(() => {})
        } finally {
            vi.unstubAllEnvs()
            evil.close()
        }
        expect(seen).toEqual([])
    })

    it('この PC の中のサーバー（http://127.0.0.1 など）には、トークンを渡さない', async () => {
        const ask = (u: string) => base.onAuth(u, {} as never) as Promise<{ cancel?: boolean }>
        expect((await ask('http://127.0.0.1:11434/x.git')).cancel).toBe(true)
        expect((await ask('http://localhost:8080/x.git')).cancel).toBe(true)
    })

    it('.git の中は、名前の書き方を変えても読み書きできない', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-dotgit-'))
        for (const p of [
            '.git/config',
            '.GIT/config',
            '.git./hooks/pre-commit',
            '.git /config',
            'sub/../.git/config',
            '.git::$INDEX_ALLOCATION/config',
            'git~1/config',
            '.g‌it/config',
        ]) {
            expect(() => git.safeJoin(dir, p), p).toThrow()
        }
        expect(git.safeJoin(dir, '規程/.github.md')).toContain('.github.md')
        expect(git.safeJoin(dir, 'git/メモ.md')).toContain('メモ.md')
    })

    it('文書として扱えるのは、隠しフォルダの外にある .md だけ', () => {
        for (const p of ['.git/config', 'a.command', 'run.sh', '.ssh/x.md', 'a/../b.md', '/etc/x.md', 'a//b.md', 'x.md.exe', 12, null]) {
            expect(() => git.assertDocPath(p), String(p)).toThrow()
        }
        expect(() => git.assertDocPath('契約書/業務委託契約書.md')).not.toThrow()
        expect(() => git.assertDocPath('就業規則.MD')).not.toThrow()
    })
})

describe('リモートから届く記録', () => {
    it('プルリクエストの番号は、正の整数のときだけ使う', () => {
        const ev = (pr: unknown) => ({ branch: '案/x', action: 'request', at: '2026-01-01', pr }) as never
        expect(prOf(ev(7))).toBe(7)
        for (const bad of ['../../../victim/repo/pulls/7', '7', 7.5, -1, 0, {}, null]) expect(prOf(ev(bad)), String(bad)).toBeUndefined()
    })

    it('番号が正しくなければ、GitHub・GitLab の API を呼ばない', () => {
        const bad = '../../../victim-org/victim-repo/pulls/7' as unknown as number
        expect(() => gh.getPull({ owner: 'a', repo: 'b' }, bad)).toThrow('番号が正しくありません')
        expect(() => gl.getMr({ base: 'https://gitlab.com', path: 'a/b' }, bad)).toThrow('番号が正しくありません')
    })

    it('納品先のフォルダは記録に載せず、記録に書かれたフォルダも使わない', async () => {
        const dir = join(root, 'deliver')
        await git.cloneRepo(url, dir)
        await git.writeDoc(dir, '規程.md', V1 + '- 追加\n')
        const oid = await git.saveVersion(dir, { message: '改定' })
        const out = fs.mkdtempSync(join(os.tmpdir(), 'cd-out-'))
        const bytes = async () => new Uint8Array([1])
        const rec = await wf.deliver(dir, { docPath: '規程.md', oid, to: 'A社', memo: '', items: ['docPdf'], publishRelease: false }, out, {
            docPdf: bytes,
            docDocx: bytes,
            cmpPdf: bytes,
            cmpDocx: bytes,
        })
        expect(rec.folder.startsWith(out)).toBe(true)
        const stored = await records.readRecords<{ id: string; folder: string }>(dir, records.RECORD.deliveries)
        expect(stored.map((r) => r.folder)).toEqual([''])
        expect(JSON.stringify(stored)).not.toContain(out)

        await records.writeRecord(dir, `${records.RECORD.deliveries}evil.json`, {
            id: 'evil',
            docPath: '規程.md',
            at: '2026-01-01T00:00:00.000Z',
            items: ['docPdf'],
            folder: '/Applications/Calculator.app',
        })
        const list = await wf.listDeliveries(dir, '規程.md')
        expect(list.find((d) => d.id === 'evil')?.folder).toBe('')
        expect(list.find((d) => d.id === rec.id)?.folder).toBe(rec.folder)
    })
})

describe('AI の道具', () => {
    it('画面で開いているリポジトリの外と、.md 以外には触れない', async () => {
        const a = fs.mkdtempSync(join(os.tmpdir(), 'cd-ai-a-'))
        const b = fs.mkdtempSync(join(os.tmpdir(), 'cd-ai-b-'))
        for (const d of [a, b]) {
            await git.initRepo(d)
            await git.writeDoc(d, '規程.md', V1)
        }
        repos.push({ name: 'A社', dir: a }, { name: 'B社', dir: b })
        const ctx = { by: 'ai' as const, changed: () => {}, repoDir: a }
        expect(await tools.runTool('read_doc', { repo: 'A社', path: '規程.md' }, ctx)).toContain('初版')
        await expect(tools.runTool('read_doc', { repo: 'B社', path: '規程.md' }, ctx)).rejects.toThrow('開いているリポジトリ')
        await expect(tools.runTool('write_doc', { repo: 'B社', path: '規程.md', content: 'x' }, ctx)).rejects.toThrow('開いているリポジトリ')
        await expect(tools.runTool('read_doc', { repo: 'A社', path: '.git/config' }, ctx)).rejects.toThrow('.md')
        expect(await tools.runTool('list_repos', {}, ctx)).not.toContain('B社')
        expect(await tools.runTool('list_repos', {}, { by: 'mcp', changed: () => {} })).toContain('B社')
    })
})

describe('画面の CSP', () => {
    const html =
        '<script type="importmap">{"imports":{}}</script><script type="module" src="/a.js"></script><script>window.x=1</script><script type="application/json">{"a":1}</script>'
    it('元からあるインラインのスクリプトだけをハッシュで許可する', () => {
        expect(inlineScriptHashes(html)).toHaveLength(2)
        const csp = cspFor(html)
        expect(csp).not.toContain("'unsafe-inline' 'sha256")
        expect(csp).toMatch(/script-src 'self' 'sha256-[^;]+;/)
        expect(csp.match(/script-src [^;]*/)![0]).not.toContain('unsafe-inline')
        expect(csp).toContain("object-src 'none'")
        expect(csp).toContain("base-uri 'none'")
    })
})
