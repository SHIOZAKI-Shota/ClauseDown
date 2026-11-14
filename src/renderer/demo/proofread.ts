import type { ProofreadIssue } from '@shared/api'
import type { AppPrefs } from '@shared/prefs'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: ProofreadIssue[]) => void; reject: (e: Error) => void }>()

function start(): Worker {
    if (worker) return worker
    const w = new Worker(new URL('./proofread.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; result?: ProofreadIssue[]; error?: string }>) => {
        const p = pending.get(e.data.id)
        if (!p) return
        pending.delete(e.data.id)
        if (e.data.error !== undefined) p.reject(new Error(e.data.error))
        else p.resolve(e.data.result ?? [])
    }
    worker = w
    return w
}

let dicPath = '/dict/'
export function setDictionaryPath(path: string) {
    dicPath = path
}

export function proofreadInBrowser(text: string, prefs: AppPrefs): Promise<ProofreadIssue[]> {
    if (!text.trim()) return Promise.resolve([])
    const id = ++seq
    const config = { rules: prefs.proofreadRules ?? {}, joshiAllow: prefs.proofreadJoshiAllow }
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        start().postMessage({ id, text, config: JSON.parse(JSON.stringify(config)), dicPath })
    })
}
