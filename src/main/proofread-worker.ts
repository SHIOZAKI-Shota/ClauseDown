import { proofread } from './proofread-core'

interface Request {
    id: number
    text: string
}

process.parentPort.on('message', async (e: { data: Request }) => {
    const { id, text } = e.data
    try {
        process.parentPort.postMessage({ id, result: await proofread(text) })
    } catch (err) {
        process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
})
