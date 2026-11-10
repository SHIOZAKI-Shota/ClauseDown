import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0', isPackaged: false, getPath: () => '/tmp' } }))
const { bridgeEntry, entryState, parseConfig, withEntry } = await import('../src/main/claude-desktop')

const mac = bridgeEntry('darwin', '/Applications/ClauseDown.app/Contents/Resources/mcp-bridge', '/Users/a/Library/Application Support/ClauseDown/mcp.sock')

describe('Claude Desktop の設定ファイル', () => {
    it('macOS は同梱のスクリプトとソケットの場所を書く。Windows は PowerShell で動かす', () => {
        expect(mac).toEqual({
            command: '/Applications/ClauseDown.app/Contents/Resources/mcp-bridge/mcp-bridge.sh',
            args: ['/Users/a/Library/Application Support/ClauseDown/mcp.sock'],
        })
        const win = bridgeEntry('win32', 'C:\\Program Files\\ClauseDown\\resources\\mcp-bridge', '\\\\.\\pipe\\clausedown-mcp-a')
        expect(win.command).toBe('powershell.exe')
        expect(win.args.slice(0, 4)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
        expect(win.args.at(-1)).toBe('\\\\.\\pipe\\clausedown-mcp-a')
    })

    it('ほかの設定と、ほかの MCP サーバーを残して足し引きする', () => {
        const before = { theme: 'dark', mcpServers: { other: { command: 'x' } } }
        const added = withEntry(before, mac)
        expect(added).toEqual({ theme: 'dark', mcpServers: { other: { command: 'x' }, clausedown: mac } })
        expect(before.mcpServers).toEqual({ other: { command: 'x' } })
        expect(withEntry(added, null)).toEqual(before)
        expect(withEntry({ theme: 'dark' }, null)).toEqual({ theme: 'dark' })
        expect(withEntry({}, mac)).toEqual({ mcpServers: { clausedown: mac } })
    })

    it('登録の状態を見分ける', () => {
        expect(entryState({}, mac)).toBe('unregistered')
        expect(entryState(withEntry({}, mac), mac)).toBe('registered')
        expect(entryState(withEntry({}, { command: '/old/place/mcp-bridge.sh', args: ['x'] }), mac)).toBe('outdated')
    })

    it('読めないファイルは書き換えない', () => {
        expect(parseConfig(null)).toEqual({})
        expect(parseConfig('  \n')).toEqual({})
        expect(() => parseConfig('{ "a": 1, }')).toThrow('読めませんでした')
        expect(() => parseConfig('[1]')).toThrow('想定と違います')
    })
})
