import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const target = () => `${process.platform}-${process.arch}`

function candidates(name: string): string[] {
    const dirs = [join(__dirname, '../../native', name)]
    if (process.resourcesPath) dirs.unshift(join(process.resourcesPath, 'native', name))
    const prefix = `clausedown-${name}.${target()}`
    return dirs.flatMap((d) => {
        try {
            return readdirSync(d)
                .filter((f) => f.startsWith(prefix) && f.endsWith('.node'))
                .map((f) => join(d, f))
        } catch {
            return []
        }
    })
}

export function loadNative<T>(name: string): T | null {
    const req = createRequire(__filename)
    for (const path of candidates(name)) {
        if (!existsSync(path)) continue
        try {
            return req(path) as T
        } catch (e) {
            console.error(`[${name}] ネイティブモジュールを読み込めませんでした`, e)
        }
    }
    return null
}
