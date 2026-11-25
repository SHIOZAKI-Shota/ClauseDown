import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'ja']
const run = (cmd, args, env = {}) =>
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } })

run('npm', ['run', 'build'])
for (const lang of langs) run('npx', ['vitest', 'run', '-c', 'vitest.e2e.config.ts', 'scripts/manual-shots.e2e.ts'], { MANUAL_LANG: lang })
