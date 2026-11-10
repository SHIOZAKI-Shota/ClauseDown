import fs, { promises as fsp } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type { DesktopStatus } from '../shared/api'
import { writeAtomic } from './atomic'
import { mcpSocketPath } from './mcp-server'

const NAME = 'clausedown'
const FILE = 'claude_desktop_config.json'

export interface DesktopEntry {
    command: string
    args: string[]
}

export function bridgeEntry(platform: NodeJS.Platform, bridgeDir: string, socket: string): DesktopEntry {
    if (platform === 'win32') {
        return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(bridgeDir, 'mcp-bridge.ps1'), socket] }
    }
    return { command: join(bridgeDir, 'mcp-bridge.sh'), args: [socket] }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseConfig(text: string | null): Record<string, unknown> {
    if (text === null || !text.trim()) return {}
    let v: unknown
    try {
        v = JSON.parse(text)
    } catch {
        throw new Error('Claude Desktop の設定ファイルを読めませんでした。ファイルの書き方を直してから、もう一度押してください')
    }
    if (!isObject(v)) throw new Error('Claude Desktop の設定ファイルの形が想定と違います')
    return v
}

export function withEntry(config: Record<string, unknown>, entry: DesktopEntry | null): Record<string, unknown> {
    const servers = isObject(config.mcpServers) ? { ...config.mcpServers } : {}
    if (entry) servers[NAME] = entry
    else delete servers[NAME]
    if (!entry && !isObject(config.mcpServers)) return config
    return { ...config, mcpServers: servers }
}

export function entryState(config: Record<string, unknown>, expected: DesktopEntry): 'registered' | 'unregistered' | 'outdated' {
    const cur = isObject(config.mcpServers) ? config.mcpServers[NAME] : undefined
    if (cur === undefined) return 'unregistered'
    return JSON.stringify(cur) === JSON.stringify(expected) ? 'registered' : 'outdated'
}

function configDir(): string | null {
    const home = os.homedir()
    if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude')
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA
        if (local) {
            const pkgs = join(local, 'Packages')
            const store = fs.existsSync(pkgs) ? fs.readdirSync(pkgs).find((n) => /^Claude_/i.test(n)) : undefined
            if (store) return join(pkgs, store, 'LocalCache', 'Roaming', 'Claude')
        }
        return process.env.APPDATA ? join(process.env.APPDATA, 'Claude') : null
    }
    return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude')
}

const bridgeDir = () => (app.isPackaged ? join(process.resourcesPath, 'mcp-bridge') : resolve(import.meta.dirname, '../../build/mcp-bridge'))

function expected(): DesktopEntry {
    const socket = mcpSocketPath()
    if (!socket) throw new Error('Claude Desktop 用の入口の場所を決められませんでした')
    return bridgeEntry(process.platform, bridgeDir(), socket)
}

async function readConfig(file: string): Promise<string | null> {
    return fsp.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
    })
}

export async function desktopStatus(): Promise<DesktopStatus> {
    const dir = configDir()
    if (!dir || !fs.existsSync(dir)) return { state: 'notInstalled', path: null }
    const file = join(dir, FILE)
    try {
        return { state: entryState(parseConfig(await readConfig(file)), expected()), path: file }
    } catch (e) {
        return { state: 'broken', path: file, error: (e as Error).message }
    }
}

async function save(entry: DesktopEntry | null): Promise<DesktopStatus> {
    const dir = configDir()
    if (!dir || !fs.existsSync(dir)) throw new Error('Claude Desktop が見つかりません。先に Claude Desktop を入れて、一度起動してください')
    const file = join(dir, FILE)
    const text = await readConfig(file)
    const next = withEntry(parseConfig(text), entry)
    if (text !== null) await fsp.writeFile(`${file}.bak`, text, 'utf8')
    await writeAtomic(file, JSON.stringify(next, null, 2) + '\n')
    return desktopStatus()
}

export const registerDesktop = () => save(expected())
export const unregisterDesktop = () => save(null)
