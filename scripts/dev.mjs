import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const PORT = 3000
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const shell = process.platform === 'win32'

spawnSync('node', ['scripts/licenses.mjs'], { stdio: 'inherit', env })

const nuxt = spawn('npx', ['nuxt', 'dev', '--port', String(PORT)], { stdio: 'inherit', env, shell })

const waitPort = () =>
    new Promise((resolve) => {
        const tryOnce = () => {
            const s = net.connect(PORT, '127.0.0.1', () => {
                s.end()
                resolve()
            })
            s.on('error', () => setTimeout(tryOnce, 500))
        }
        tryOnce()
    })

await waitPort()
const electron = spawn('npx', ['electron-vite', 'dev'], {
    stdio: 'inherit',
    env: { ...env, ELECTRON_RENDERER_URL: `http://localhost:${PORT}` },
    shell,
})
const stop = () => {
    nuxt.kill()
    electron.kill()
    process.exit()
}
electron.on('exit', stop)
process.on('SIGINT', stop)
