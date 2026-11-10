import type { ProofreadConfig } from '../shared/api'
import { proofread } from './proofread-core'

interface Request {
    id: number
    text: string
    config: ProofreadConfig
}

process.parentPort.on('message', async (e: { data: Request }) => {
    const { id, text, config } = e.data
    try {
        process.parentPort.postMessage({ id, result: await proofread(text, config) })
    } catch (err) {
        process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
})
