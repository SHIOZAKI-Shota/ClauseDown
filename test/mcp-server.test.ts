import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const repos: { name: string; dir: string }[] = []
const secrets: Record<string, string> = {}
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))
vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos, author: { name: 'テスト', email: 't@example.com' }, username: 'u' }),
    loadSecret: async (name: string) => secrets[name] ?? null,
    saveSecret: async (name: string, value: string) => {
        secrets[name] = value
    },
}))
const git = await import('../src/main/git')
const { applyMcp, stopMcp, mcpToken } = await import('../src/main/mcp-server')

const PORT = 39300 + Math.floor(Math.random() * 500)
const URL_ = `http://127.0.0.1:${PORT}/mcp`
const changed = vi.fn()
let token = ''
let dir = ''

beforeAll(async () => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'cd-mcp-'))
    await git.initRepo(dir)
    fs.writeFileSync(join(dir, '就業規則.md'), '# 就業規則\n\n### 目的\n- 定める。\n')
    repos.push({ name: 'A社_規程', dir })
    token = await mcpToken()
    const st = await applyMcp({ enabled: true, port: PORT }, changed)
    expect(st).toEqual({ running: true, url: URL_ })
})
afterAll(() => stopMcp())

async function connect(t: string) {
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }))
    return client
}

describe('MCP サーバー', () => {
    it('道具とプロンプトの一覧を返し、版を保存する道具は出さない', async () => {
        const client = await connect(token)
        const tools = (await client.listTools()).tools.map((t) => t.name)
        expect(tools).toEqual(expect.arrayContaining(['list_repos', 'read_doc', 'edit_doc', 'check_doc', 'compare_versions']))
        expect(tools.some((n) => /save|merge|deliver|commit/.test(n))).toBe(false)
        const prompts = (await client.listPrompts()).prompts.map((p) => p.name)
        expect(prompts).toContain('legal_check')
        await client.close()
    })

    it('道具を呼んで文書を書き換えると、画面に知らせる', async () => {
        const client = await connect(token)
        const read = await client.callTool({ name: 'read_doc', arguments: { repo: 'A社_規程', path: '就業規則.md' } })
        expect(JSON.stringify(read.content)).toContain('〔第1条〕### 目的')
        await client.callTool({ name: 'edit_doc', arguments: { repo: 'A社_規程', path: '就業規則.md', old_text: '定める。', new_text: '定めるものとする。' } })
        expect(fs.readFileSync(join(dir, '就業規則.md'), 'utf8')).toContain('定めるものとする。')
        expect(changed).toHaveBeenCalledWith(dir, '就業規則.md')
        const bad = await client.callTool({ name: 'write_doc', arguments: { repo: 'A社_規程', path: '.git/x.md', content: '# x' } })
        expect(bad.isError).toBe(true)
        await client.close()
    })

    it('トークンが違えば断る', async () => {
        await expect(connect('wrong')).rejects.toThrow()
    })

    it('ブラウザからの呼び出し（Origin 付き）と、ほかの Host 名は断る', async () => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
        const fromBrowser = await fetch(URL_, { method: 'POST', body, headers: { ...headers, Origin: 'https://evil.example' } })
        expect(fromBrowser.status).toBe(403)
        const http = await import('node:http')
        const status = await new Promise<number>((done) => {
            const req = http.request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { ...headers, Host: `evil.example:${PORT}` } }, (res) => done(res.statusCode ?? 0))
            req.end(body)
        })
        expect(status).toBe(403)
    })
})
