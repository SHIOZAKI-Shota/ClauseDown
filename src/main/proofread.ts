import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { ProofreadConfig, ProofreadContext, ProofreadIssue } from '../shared/api'
import { loadSettings } from './settings'

const TIMEOUT_MS = 20_000

interface Pending {
    resolve: (r: ProofreadIssue[]) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
}

let child: UtilityProcess | null = null
let seq = 0
const pending = new Map<number, Pending>()

function failAll(message: string) {
    for (const [id, p] of pending) {
        clearTimeout(p.timer)
        p.reject(new Error(message))
        pending.delete(id)
    }
}

function worker(): UtilityProcess {
    if (child) return child
    const c = utilityProcess.fork(join(import.meta.dirname, 'proofread-worker.js'), [], { serviceName: 'ClauseDown 校閲' })
    c.on('message', (msg: { id: number; result?: ProofreadIssue[]; error?: string }) => {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.error !== undefined) p.reject(new Error(msg.error))
        else p.resolve(msg.result ?? [])
    })
    c.on('exit', () => {
        if (child === c) child = null
        failAll('校閲のプロセスが終了しました')
    })
    child = c
    return c
}

async function configFor(_ctx: ProofreadContext | undefined): Promise<ProofreadConfig> {
    const { prefs } = await loadSettings()
    return {
        rules: prefs.proofreadRules ?? {},
        joshiAllow: Array.isArray(prefs.proofreadJoshiAllow) ? prefs.proofreadJoshiAllow.filter((s) => typeof s === 'string') : undefined,
    }
}

export async function proofread(text: unknown, ctx?: ProofreadContext): Promise<ProofreadIssue[]> {
    if (typeof text !== 'string' || !text.trim()) return []
    const config = await configFor(ctx)
    const id = ++seq
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error('校閲に時間がかかりすぎたため、やめました'))
            child?.kill()
        }, TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        worker().postMessage({ id, text, config })
    })
}

export function stopProofread() {
    child?.kill()
    child = null
}
