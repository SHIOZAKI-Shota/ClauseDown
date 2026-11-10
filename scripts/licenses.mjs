import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
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
    return /^https:\/\//.test(u) ? u : undefined
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
console.log(`licenses: ${list.length} packages${recorded === 0 ? '（バンドルの記録なし。npm run build で全部そろう）' : ''}`)
