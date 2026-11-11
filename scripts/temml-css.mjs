import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'node_modules/temml/dist')
const { version } = JSON.parse(readFileSync(join(root, 'node_modules/temml/package.json'), 'utf8'))
const font = readFileSync(join(dist, 'Temml.woff2')).toString('base64')
const css = readFileSync(join(dist, 'Temml-Local.css'), 'utf8')
    .replace("url('Temml.woff2')", `url(data:font/woff2;base64,${font})`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
writeFileSync(
    join(root, 'src/shared/temml-css.ts'),
    `// node scripts/temml-css.mjs で temml ${version} の dist/Temml-Local.css から生成。temml を更新したら作り直す\nexport const TEMML_CSS = ${JSON.stringify(css)}\n`,
)
console.log(`temml-css: temml ${version}, ${css.length} chars`)
