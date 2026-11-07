import { execFile } from 'node:child_process'

let cache: Promise<string[]> | undefined

function query(): Promise<string[]> {
    if (process.platform !== 'win32') return Promise.resolve([])
    const script =
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
        'Add-Type -AssemblyName System.Drawing;' +
        '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
    return new Promise((resolve) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
            (err, out) => {
                if (err) return resolve([])
                const names = out
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter((s) => s && !s.startsWith('@'))
                resolve([...new Set(names)])
            },
        )
    })
}

export function listFonts(): Promise<string[]> {
    cache ??= query().then((r) => {
        if (!r.length) cache = undefined
        return r
    })
    return cache
}
