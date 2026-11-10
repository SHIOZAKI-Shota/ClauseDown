import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
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
let socketServer: http.Server | null = null
let socketFile: string | null = null
let state: AiStatus['mcp'] = { running: false, url: '' }

export function mcpSocketPath(): string | null {
    try {
        if (process.platform === 'win32') return `\\\\.\\pipe\\clausedown-mcp-${os.userInfo().username.replace(/[^\w.-]/g, '_')}`
        return join(app.getPath('userData'), 'mcp.sock')
    } catch {
        return null
    }
}

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

const closeServer = (s: http.Server | null) => (s ? new Promise<void>((done) => s.close(() => done())) : Promise.resolve())

export async function stopMcp() {
    const s = server
    const sock = socketServer
    const file = socketFile
    server = null
    socketServer = null
    socketFile = null
    state = { running: false, url: '' }
    await Promise.all([closeServer(s), closeServer(sock)])
    if (file && process.platform !== 'win32') await fsp.rm(file, { force: true })
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, changed: ToolContext['changed']) {
    const mcp = buildServer(changed)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
        void transport.close()
        void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
}

const pathOf = (req: http.IncomingMessage) => new URL(req.url ?? '/', 'http://127.0.0.1').pathname

function alive(path: string): Promise<boolean> {
    return new Promise((done) => {
        const c = net.connect(path)
        c.once('connect', () => (c.destroy(), done(true)))
        c.once('error', () => done(false))
    })
}

async function listenSocket(path: string, changed: ToolContext['changed']): Promise<string | null> {
    if (process.platform !== 'win32') {
        if (await alive(path)) return 'ほかの ClauseDown が Claude Desktop 用の入口を使っています'
        await fsp.rm(path, { force: true })
    }
    const s = http.createServer(async (req, res) => {
        try {
            if (pathOf(req) !== '/mcp') return reply(res, 404, 'not found')
            if (req.headers.origin) return reply(res, 403, 'browser requests are not allowed')
            await handleMcp(req, res, changed)
        } catch (e) {
            if (!res.headersSent) reply(res, 500, (e as Error).message)
        }
    })
    const error = await new Promise<string | null>((done) => {
        s.once('error', (e) => done(e.message))
        s.listen(path, () => done(null))
    })
    if (error) return error
    if (process.platform !== 'win32') await fsp.chmod(path, 0o600)
    socketServer = s
    socketFile = path
    return null
}

export async function applyMcp(
    config: McpConfig | undefined,
    changed: ToolContext['changed'],
    opts: { socket?: string | null } = {},
): Promise<AiStatus['mcp']> {
    await stopMcp()
    if (!config?.enabled) return state
    const { port } = config
    const token = await mcpToken()
    const url = `http://127.0.0.1:${port}/mcp`
    const s = http.createServer(async (req, res) => {
        try {
            const host = req.headers.host ?? ''
            if (pathOf(req) !== '/mcp') return reply(res, 404, 'not found')
            if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, 'forbidden host')
            if (req.headers.origin) return reply(res, 403, 'browser requests are not allowed')
            const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
            if (!sameToken(auth, token)) return reply(res, 401, 'unauthorized')

            await handleMcp(req, res, changed)
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
    const sock = opts.socket === undefined ? mcpSocketPath() : opts.socket
    if (sock && state.running) {
        const err = await listenSocket(sock, changed)
        state = err ? { ...state, socketError: err } : { ...state, socket: sock }
    }
    return state
}
