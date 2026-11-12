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
const { spawn } = await import('node:child_process')

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
    const st = await applyMcp({ enabled: true, port: PORT }, changed, { socket: null })
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
            const req = http.request(
                { host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { ...headers, Host: `evil.example:${PORT}` } },
                (res) => done(res.statusCode ?? 0),
            )
            req.end(body)
        })
        expect(status).toBe(403)
    })
})

const BRIDGE = join(import.meta.dirname, '../build/mcp-bridge/mcp-bridge.sh')

function bridge(sock: string) {
    const p = spawn('sh', [BRIDGE, sock])
    let buf = ''
    const lines: string[] = []
    const waiters: (() => void)[] = []
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
        buf += d
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
            lines.push(buf.slice(0, i))
            buf = buf.slice(i + 1)
            waiters.shift()?.()
        }
    })
    const next = async () => {
        if (!lines.length) await new Promise<void>((r) => waiters.push(r))
        return JSON.parse(lines.shift()!)
    }
    const send = (msg: object) => p.stdin.write(JSON.stringify(msg) + '\n')
    return { p, next, send, pending: () => lines.length }
}

describe.skipIf(process.platform === 'win32')('Claude Desktop 用の通訳（ソケット）', () => {
    let sockDir = ''
    let sock = ''
    beforeAll(async () => {
        await stopMcp()
        sockDir = fs.mkdtempSync(join(os.tmpdir(), 'cd-sock-'))
        sock = join(sockDir, 'mcp.sock')
        fs.writeFileSync(sock, '')
        const st = await applyMcp({ enabled: true, port: PORT }, changed, { socket: sock })
        expect(st.socket).toBe(sock)
    })
    afterAll(async () => {
        await stopMcp()
        fs.rmSync(sockDir, { recursive: true, force: true })
    })

    it('残っていたファイルを片付けて待ち受け、本人だけが開ける', () => {
        expect(fs.statSync(sock).isSocket()).toBe(true)
        expect(fs.statSync(sock).mode & 0o777).toBe(0o600)
    })

    it('トークンなしで、stdio から道具を呼べる。通知には何も返さない', async () => {
        const b = bridge(sock)
        b.send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        })
        expect((await b.next()).result.serverInfo.name).toBe('clausedown')
        b.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        b.send({ jsonrpc: '2.0', id: 'two', method: 'tools/list' })
        const list = await b.next()
        expect(list.id).toBe('two')
        expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('read_doc')
        b.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_doc', arguments: { repo: 'A社_規程', path: '就業規則.md' } } })
        const read = await b.next()
        expect(read.id).toBe(3)
        expect(JSON.stringify(read.result.content)).toContain('〔第1条〕### 目的')
        expect(b.pending()).toBe(0)
        b.p.stdin.end()
    })

    it('ClauseDown が止まっていれば、要求の id でエラーを返す', async () => {
        await stopMcp()
        expect(fs.existsSync(sock)).toBe(false)
        const b = bridge(sock)
        b.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' })
        const err = await b.next()
        expect(err.id).toBe(7)
        expect(err.error.message).toContain('ClauseDown が起動していない')
        b.p.stdin.end()
    })
})
