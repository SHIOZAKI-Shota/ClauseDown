import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { app } from 'electron'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { TOOLS, type ToolContext } from './ai-tools'
import { AI_PRESETS, AI_SYSTEM } from '../shared/ai-presets'
import { loadSecret, saveSecret } from './settings'
import type { AiStatus, McpConfig } from '../shared/api'

let server: http.Server | null = null
let state: AiStatus['mcp'] = { running: false, url: '' }

export const mcpState = () => state

export async function mcpToken(): Promise<string> {
    return (await loadSecret('mcp-token')) ?? regenerateMcpToken()
}

export async function regenerateMcpToken(): Promise<string> {
    const token = randomBytes(24).toString('base64url')
    await saveSecret('mcp-token', token)
    return token
}

function buildServer(changed: ToolContext['changed']): McpServer {
    const mcp = new McpServer({ name: 'clausedown', version: app.getVersion() }, { instructions: AI_SYSTEM })
    const ctx: ToolContext = { by: 'mcp', changed }
    for (const t of TOOLS) {
        mcp.registerTool(
            t.name,
            {
                title: t.title,
                description: t.description,
                inputSchema: t.schema,
                annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
            },
            async (args: unknown) => {
                try {
                    return { content: [{ type: 'text' as const, text: await t.run(args as never, ctx) }] }
                } catch (e) {
                    return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true }
                }
            },
        )
    }
    for (const p of AI_PRESETS) {
        mcp.registerPrompt(
            p.id,
            {
                title: p.label,
                description: p.description,
                argsSchema: { repo: z.string().describe('リポジトリの名前'), path: z.string().describe('文書のパス') },
            },
            ({ repo, path }) => ({
                messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `リポジトリ「${repo}」の ${path} について。${p.prompt}` } }],
            }),
        )
    }
    return mcp
}

function sameToken(given: string, token: string) {
    const a = Buffer.from(given)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
}

function reply(res: http.ServerResponse, status: number, message: string) {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }))
}

export async function stopMcp() {
    const s = server
    server = null
    state = { running: false, url: '' }
    if (s) await new Promise<void>((done) => s.close(() => done()))
}

export async function applyMcp(config: McpConfig | undefined, changed: ToolContext['changed']): Promise<AiStatus['mcp']> {
    await stopMcp()
    if (!config?.enabled) return state
    const { port } = config
    const token = await mcpToken()
    const url = `http://127.0.0.1:${port}/mcp`
    const s = http.createServer(async (req, res) => {
        try {
            const host = req.headers.host ?? ''
            if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') return reply(res, 404, 'not found')
            if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, 'forbidden host')
            if (req.headers.origin) return reply(res, 403, 'browser requests are not allowed')
            const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
            if (!sameToken(auth, token)) return reply(res, 401, 'unauthorized')

            const mcp = buildServer(changed)
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
            res.on('close', () => {
                void transport.close()
                void mcp.close()
            })
            await mcp.connect(transport)
            await transport.handleRequest(req, res)
        } catch (e) {
            if (!res.headersSent) reply(res, 500, (e as Error).message)
        }
    })
    await new Promise<void>((done) => {
        s.once('error', (e: NodeJS.ErrnoException) => {
            state = { running: false, url, error: e.code === 'EADDRINUSE' ? `ポート ${port} はほかのアプリが使っています。別の番号にしてください` : e.message }
            done()
        })
        s.listen(port, '127.0.0.1', () => {
            server = s
            state = { running: true, url }
            done()
        })
    })
    return state
}
