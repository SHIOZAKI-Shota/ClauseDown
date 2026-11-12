import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'
import type { AiEvent } from '../src/shared/api'

const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-ai-'))
const settings = { repos: [{ name: '規程', dir }], author: { name: 'テスト', email: 't@example.com' }, username: 'u', ai: {} as Record<string, unknown> }
const secrets: Record<string, string> = {}
vi.mock('../src/main/settings', () => ({
    getToken: async () => 'gh-token',
    loadSettings: async () => settings,
    loadSecret: async (name: string) => secrets[name] ?? null,
    saveSecret: async (name: string, v: string) => void (secrets[name] = v),
}))
const git = await import('../src/main/git')
const { aiRun, testAi } = await import('../src/main/ai-agent')
const { keyName, resolveAi } = await import('../src/main/ai/provider')
const { cleanAiConfig } = await import('../src/shared/ai-providers')

let server: http.Server
let base = ''
const requests: {
    auth?: string
    body: { model: string; messages: { role: string; content?: string; tool_call_id?: string }[]; tools?: { function: { name: string } }[]; stream?: boolean }
}[] = []

function sse(res: http.ServerResponse, chunks: unknown[]) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
    res.end('data: [DONE]\n\n')
}
const chunk = (delta: unknown, finish: string | null = null) => ({
    id: 'x',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
})

beforeAll(async () => {
    await git.initRepo(dir)
    await git.writeDoc(dir, '就業規則.md', '# 就業規則\n\n### 目的\n- この規則は、従業員の就業に関する事項を定める。\n')
    await git.saveVersion(dir, { message: '初版' })

    server = http.createServer(async (req, res) => {
        const raw: Buffer[] = []
        for await (const c of req) raw.push(c as Buffer)
        const body = JSON.parse(Buffer.concat(raw).toString() || '{}')
        requests.push({ auth: req.headers.authorization, body })
        if (body.model === 'bad-key')
            return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key' } }))
        if (body.model === 'no-tools')
            return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'model does not support tools' } }))
        if (!body.stream) {
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(
                JSON.stringify({
                    id: 'x',
                    object: 'chat.completion',
                    created: 0,
                    model: body.model,
                    choices: [{ index: 0, message: { role: 'assistant', content: '接続できました' }, finish_reason: 'stop' }],
                }),
            )
        }
        const last = body.messages.at(-1)
        if (last.role === 'user') {
            return sse(res, [
                chunk({ role: 'assistant', content: '確認します。' }),
                chunk({ tool_calls: [{ index: 0, type: 'function', function: { name: 'read_', arguments: '' } }] }),
                chunk({ tool_calls: [{ index: 0, function: { name: 'doc', arguments: '{"repo":"規程",' } }] }),
                chunk({ tool_calls: [{ index: 0, function: { arguments: '"path":"就業規則.md"}' } }] }),
                chunk({}, 'tool_calls'),
            ])
        }
        sse(res, [chunk({ content: '第1条は' }), chunk({ content: '問題ありません。' }), chunk({}, 'stop')])
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
afterAll(() => server?.close())

async function run(instruction: string) {
    const events: AiEvent[] = []
    await aiRun(
        dir,
        { session: 's1', path: '就業規則.md', instruction },
        (e) => events.push(e),
        () => {},
    )
    return events
}

describe('OpenAI 互換の窓口', () => {
    it('道具を呼んで文書を読み、結果を渡してから回答する', async () => {
        settings.ai = { provider: 'openai', baseUrl: base, model: 'm1' }
        secrets[keyName('openai', base)!] = 'sk-test'
        const events = await run('第1条を確かめて')

        expect(
            events
                .filter((e) => e.type === 'text')
                .map((e) => (e as { text: string }).text)
                .join(''),
        ).toBe('確認します。第1条は問題ありません。')
        expect(events.find((e) => e.type === 'tool')).toMatchObject({ label: expect.stringContaining('就業規則.md') })
        expect(events.at(-1)).toEqual({ session: 's1', type: 'done' })

        const [first, second] = requests.slice(-2)
        expect(first.auth).toBe('Bearer sk-test')
        expect(first.body.messages[0]).toMatchObject({ role: 'system' })
        expect(first.body.tools?.map((t) => t.function.name)).toContain('edit_doc')
        const tool = second.body.messages.find((m) => m.role === 'tool')!
        expect(tool.tool_call_id).toBeTruthy()
        expect(tool.content).toContain('この規則は')
    })

    it('失敗は分かる言葉で知らせる', async () => {
        settings.ai = { provider: 'openai', baseUrl: base, model: 'bad-key' }
        const e1 = await run('x')
        expect(e1.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('API キーが正しくありません') })
        settings.ai = { provider: 'openai', baseUrl: base, model: 'no-tools' }
        expect((await run('x')).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('道具（tools）を使えない') })
        settings.ai = { provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1', model: 'qwen3' }
        expect((await run('x')).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('Ollama に接続できません') })
    })

    it('接続を試す', async () => {
        settings.ai = { provider: 'openai', baseUrl: base, model: 'm1' }
        expect(await testAi()).toBe('接続できました')
    })
})

describe('接続先とキー', () => {
    it('https か、この PC の中だけを接続先として認める', () => {
        expect(cleanAiConfig({ provider: 'openai', baseUrl: 'http://evil.example.com/v1' })).toEqual({ provider: 'openai' })
        expect(cleanAiConfig({ provider: 'openai', baseUrl: 'https://api.deepseek.com/v1/' })).toEqual({
            provider: 'openai',
            baseUrl: 'https://api.deepseek.com/v1',
        })
        expect(cleanAiConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }).baseUrl).toBe('http://localhost:11434/v1')
        expect(cleanAiConfig({ provider: 'nope', model: 'x y' })).toEqual({ provider: 'anthropic' })
    })

    it('キーは接続先ごとに別に持つ。Ollama はキー不要、GitHub Models は GitHub のログインを使う', async () => {
        expect(keyName('openai', 'https://api.openai.com/v1')).not.toBe(keyName('openai', 'https://api.deepseek.com/v1'))
        expect(keyName('anthropic', '')).toBe('ai-key')

        settings.ai = { provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
        expect(await resolveAi()).toMatchObject({ ready: false, reason: expect.stringContaining('API キー') })

        settings.ai = { provider: 'ollama', model: 'qwen3' }
        expect(await resolveAi()).toMatchObject({ ready: true, local: true, base: 'http://127.0.0.1:11434/v1' })
        settings.ai = { provider: 'ollama' }
        expect(await resolveAi()).toMatchObject({ ready: false, reason: expect.stringContaining('モデル') })

        settings.ai = { provider: 'github' }
        expect(await resolveAi()).toMatchObject({ ready: true, key: 'gh-token', model: 'openai/gpt-4.1', local: false })
    })
})
