import { promises as fsp } from 'node:fs'
import { randomBytes } from 'node:crypto'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function writeAtomic(full: string, data: string | Uint8Array): Promise<void> {
    const tmp = `${full}.${randomBytes(4).toString('hex')}.tmp`
    await fsp.writeFile(tmp, data, typeof data === 'string' ? 'utf8' : undefined)
    for (let i = 0; ; i++) {
        try {
            await fsp.rename(tmp, full)
            return
        } catch (e) {
            const code = (e as NodeJS.ErrnoException).code
            if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
                await fsp.rm(tmp, { force: true })
                throw e
            }
            await sleep(20 * 2 ** i)
        }
    }
}
