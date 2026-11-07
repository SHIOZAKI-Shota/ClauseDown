import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

export async function startGitServer(): Promise<{ root: string; url: string; close: () => void }> {
    const root = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-srv-'))
    const backend = join(execFileSync('git', ['--exec-path']).toString().trim(), 'git-http-backend')
    execFileSync('git', ['init', '--bare', '-b', 'main', join(root, 'docs.git')])
    execFileSync('git', ['-C', join(root, 'docs.git'), 'config', 'http.receivepack', 'true'])
    const server = http.createServer((req, res) => {
        const u = new URL(req.url!, 'http://x')
        const cgi = spawn(backend, [], {
            env: {
                ...process.env,
                GIT_PROJECT_ROOT: root,
                GIT_HTTP_EXPORT_ALL: '1',
                PATH_INFO: decodeURIComponent(u.pathname),
                REQUEST_METHOD: req.method,
                QUERY_STRING: u.search.slice(1),
                CONTENT_TYPE: req.headers['content-type'] ?? '',
                REMOTE_USER: 'u',
            },
        })
        req.pipe(cgi.stdin)
        let head = Buffer.alloc(0)
        let headerDone = false
        cgi.stdout.on('data', (chunk: Buffer) => {
            if (headerDone) return res.write(chunk)
            head = Buffer.concat([head, chunk])
            const idx = head.indexOf('\r\n\r\n')
            if (idx === -1) return
            headerDone = true
            let status = 200
            for (const line of head.subarray(0, idx).toString().split('\r\n')) {
                const [k, ...v] = line.split(':')
                if (k.toLowerCase() === 'status') status = parseInt(v.join(':'))
                else res.setHeader(k, v.join(':').trim())
            }
            res.writeHead(status)
            res.write(head.subarray(idx + 4))
        })
        cgi.stdout.on('end', () => res.end())
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(server.address() as any).port}/docs.git`
    return { root, url, close: () => server.close() }
}
