import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RECORD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/clausedown-licenses')

export function packageDirOf(id) {
    const path = id.replace(/^\0/, '').split('?')[0].replace(/\\/g, '/')
    const i = path.lastIndexOf('/node_modules/')
    if (i < 0) return null
    const rest = path.slice(i + '/node_modules/'.length).split('/')
    const n = rest[0]?.startsWith('@') ? 2 : 1
    if (rest.length <= n) return null
    return path.slice(0, i) + '/node_modules/' + rest.slice(0, n).join('/')
}

export function recordLicenses(name) {
    let ssr = false
    return {
        name: 'clausedown-record-licenses',
        apply: 'build',
        configResolved(config) {
            ssr = !!config.build?.ssr
        },
        generateBundle(_options, bundle) {
            if (name === 'renderer') {
                const env = this.environment
                if (env ? env.name !== 'client' : ssr) return
            }
            const dirs = new Set()
            for (const out of Object.values(bundle)) {
                if (out.type !== 'chunk') continue
                for (const id of out.moduleIds ?? Object.keys(out.modules ?? {})) {
                    const dir = packageDirOf(id)
                    if (dir) dirs.add(dir)
                }
            }
            mkdirSync(RECORD_DIR, { recursive: true })
            writeFileSync(join(RECORD_DIR, `${name}.json`), JSON.stringify([...dirs].sort(), null, 2))
        },
    }
}
