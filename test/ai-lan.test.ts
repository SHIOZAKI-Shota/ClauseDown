import { describe, expect, it } from 'vitest'
import { cleanAiConfig, isLanHost, safeAiBase } from '../src/shared/ai-providers'

describe('LAN 内の AI の接続先', () => {
    it('既定では、http は PC の中だけを許す', () => {
        expect(safeAiBase('http://127.0.0.1:11434/v1')).toBe(true)
        expect(safeAiBase('http://192.168.1.20:11434/v1')).toBe(false)
        expect(safeAiBase('https://api.openai.com/v1')).toBe(true)
    })

    it('LAN を許すと、プライベートアドレスと LAN 内の名前の http を許す', () => {
        const lan = { lan: true }
        for (const u of ['http://192.168.1.20:11434/v1', 'http://10.0.0.5:11434', 'http://172.16.3.4:1234/v1', 'http://ollama.local:11434', 'http://gpu-box:11434', 'http://[fd12:3456::1]:11434'])
            expect(safeAiBase(u, lan)).toBe(true)
        for (const u of ['http://8.8.8.8:11434', 'http://172.32.0.1:11434', 'http://example.com:11434', 'http://192.168.1.300:11434', 'http://user:pw@192.168.1.20:11434'])
            expect(safeAiBase(u, lan)).toBe(false)
    })

    it('保存するときも、LAN を許していなければ LAN の接続先を落とす', () => {
        const raw = { provider: 'ollama', baseUrl: 'http://192.168.1.20:11434/v1/' }
        expect(cleanAiConfig(raw).baseUrl).toBeUndefined()
        expect(cleanAiConfig(raw, { lan: true }).baseUrl).toBe('http://192.168.1.20:11434/v1')
    })

    it('LAN の名前かどうか', () => {
        expect(isLanHost('192.168.0.1')).toBe(true)
        expect(isLanHost('169.254.10.1')).toBe(true)
        expect(isLanHost('nas.home.arpa')).toBe(true)
        expect(isLanHost('api.example.com')).toBe(false)
    })
})
