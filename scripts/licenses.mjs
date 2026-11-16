import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECORD_DIR } from './license-plugin.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dirs = new Set()

let recorded = 0
if (existsSync(RECORD_DIR)) {
    for (const f of readdirSync(RECORD_DIR)) {
        if (!f.endsWith('.json')) continue
        for (const d of JSON.parse(readFileSync(join(RECORD_DIR, f), 'utf8'))) dirs.add(resolve(d))
        recorded++
    }
}

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
for (const [key, info] of Object.entries(lock.packages ?? {})) {
    if (!key || info.dev || info.devOptional) continue
    const dir = join(root, key)
    if (existsSync(join(dir, 'package.json'))) dirs.add(dir)
}

dirs.add(join(root, 'node_modules/electron'))

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-_.].*)?$/i

function licenseOf(pkg) {
    if (typeof pkg.license === 'string') return pkg.license
    if (pkg.license?.type) return pkg.license.type
    if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
    return '不明'
}

function authorOf(pkg) {
    const a = pkg.author
    if (!a) return undefined
    return typeof a === 'string' ? a : [a.name, a.email && `<${a.email}>`].filter(Boolean).join(' ')
}

function urlOf(pkg) {
    const r = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    const u = pkg.homepage || r
    if (!u) return undefined
    const m = /github\.com[/:]([^/]+\/[^/#.]+)/.exec(u)
    if (m) return `https://github.com/${m[1]}`
    return u.startsWith('https://') ? u : undefined
}

const seen = new Map()
for (const dir of dirs) {
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    if (!pkg.name || !pkg.version || pkg.name === own.name) continue
    const id = `${pkg.name}@${pkg.version}`
    if (seen.has(id)) continue
    const texts = readdirSync(dir)
        .filter((f) => LICENSE_FILE.test(f))
        .sort()
        .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    seen.set(id, {
        name: pkg.name,
        version: pkg.version,
        license: licenseOf(pkg),
        author: authorOf(pkg),
        url: urlOf(pkg),
        text: texts.join('\n\n---\n\n') || undefined,
    })
}

const NATIVE_TARGETS = ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc']

function cargoBin() {
    const candidates = [process.env.CARGO, 'cargo', join(homedir(), '.cargo/bin/cargo')].filter(Boolean)
    for (const c of candidates) {
        try {
            execFileSync(c, ['--version'], { stdio: 'ignore' })
            return c
        } catch {}
    }
    return null
}

const mitText = (authors) => `MIT License

Copyright (c) ${(authors ?? []).map((a) => a.replace(/\s*<[^>]*>/, '')).join(', ') || 'the authors'}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

function cratesOf(cargo, manifest, target) {
    const out = execFileSync(cargo, ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest, '--filter-platform', target], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    const meta = JSON.parse(out)
    const pkgs = new Map(meta.packages.map((p) => [p.id, p]))
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
    const used = new Set()
    const stack = [meta.resolve.root]
    while (stack.length) {
        const id = stack.pop()
        if (used.has(id)) continue
        used.add(id)
        for (const d of nodes.get(id)?.deps ?? []) {
            if (!d.dep_kinds.some((k) => k.kind === null)) continue
            const p = pkgs.get(d.pkg)
            if (p?.targets.every((t) => t.kind.includes('proc-macro'))) continue
            stack.push(d.pkg)
        }
    }
    used.delete(meta.resolve.root)
    return [...used].map((id) => pkgs.get(id)).filter((p) => p && p.source)
}

const nativeDirs = existsSync(join(root, 'native'))
    ? readdirSync(join(root, 'native'))
          .map((d) => join(root, 'native', d, 'Cargo.toml'))
          .filter((f) => existsSync(f))
    : []
let crates = 0
if (nativeDirs.length) {
    const cargo = cargoBin()
    const built = nativeDirs.some((m) => readdirSync(dirname(m)).some((f) => f.endsWith('.node')))
    if (!cargo && built) throw new Error('cargo が見つからないため、ネイティブモジュールの Rust の部品のライセンスを集められません')
    for (const manifest of cargo ? nativeDirs : []) {
        for (const target of NATIVE_TARGETS) {
            for (const p of cratesOf(cargo, manifest, target)) {
                const id = `crate:${p.name}@${p.version}`
                if (seen.has(id)) continue
                const dir = dirname(p.manifest_path)
                const texts = readdirSync(dir)
                    .filter((f) => LICENSE_FILE.test(f))
                    .sort()
                    .map((f) => readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
                const repo = p.repository?.startsWith('https://') ? p.repository.replace(/\.git$/, '') : undefined
                seen.set(id, {
                    name: p.name,
                    version: p.version,
                    license: p.license ?? (p.license_file ? 'LICENSE' : '不明'),
                    author: p.authors?.length ? p.authors.join(', ') : undefined,
                    url: repo ?? `https://crates.io/crates/${p.name}`,
                    text: texts.join('\n\n---\n\n') || (/\bMIT\b/.test(p.license ?? '') ? mitText(p.authors) : undefined),
                })
                crates++
            }
        }
    }
}

const BUNDLED_DATA = [
    {
        from: 'kuromoji',
        name: 'mecab-ipadic（IPA 辞書。kuromoji に同梱。校閲の日本語解析に使用）',
        version: '2.7.0-20070801',
        license: 'NAIST / ICOT Free Software',
        url: 'https://taku910.github.io/mecab/',
        section: /^mecab-ipadic-2\.7\.0-20070801\n-{3,}\n([\s\S]*)$/m,
    },
]
for (const d of BUNDLED_DATA) {
    const host = [...seen.values()].find((p) => p.name === d.from)
    const m = host?.text ? d.section.exec(host.text) : null
    if (!m) continue
    seen.set(`${d.name}@${d.version}`, { name: d.name, version: d.version, license: d.license, url: d.url, text: m[1].replace(/[\s˜]+$/, '').trim() })
}

const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
mkdirSync(join(root, 'out'), { recursive: true })
const app = {
    name: 'ClauseDown',
    version: own.version,
    license: own.license,
    text: readFileSync(join(root, 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim(),
}
writeFileSync(join(root, 'out/licenses.json'), JSON.stringify({ app, partial: recorded === 0, packages: list }))
console.log(`licenses: ${list.length} packages（Rust ${crates}）${recorded === 0 ? '（バンドルの記録なし。npm run build で全部そろう）' : ''}`)
