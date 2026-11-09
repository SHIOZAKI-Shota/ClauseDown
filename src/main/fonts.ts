import { execFile } from 'node:child_process'
import { canonicalFont } from '../shared/fonts'

let cache: Promise<string[]> | undefined

function run(file: string, args: string[]): Promise<string[]> {
    return new Promise((resolve) => {
        execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
            if (err) return resolve([])
            const names = out
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((s) => s && !s.startsWith('@') && !s.startsWith('.'))
            resolve([...new Set(names)])
        })
    })
}

function query(): Promise<string[]> {
    if (process.platform === 'win32') {
        const script =
            '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
            'Add-Type -AssemblyName System.Drawing;' +
            '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
        return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    }
    if (process.platform === 'darwin') {
        const script =
            'ObjC.import("AppKit");' +
            'var fm = $.NSFontManager.sharedFontManager;' +
            'ObjC.deepUnwrap(fm.availableFontFamilies).map(function (f) { return ObjC.unwrap(fm.localizedNameForFamilyFace(f, $())) || f }).join("\\n")'
        return run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script]).then((names) => [...new Set(names.map(canonicalFont))])
    }
    return Promise.resolve([])
}

export function listFonts(): Promise<string[]> {
    cache ??= query().then((r) => {
        if (!r.length) cache = undefined
        return r
    })
    return cache
}
