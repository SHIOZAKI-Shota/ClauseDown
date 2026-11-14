import { fileURLToPath } from 'node:url'
import { recordLicenses } from './scripts/license-plugin.mjs'

const DEMO = process.env.CLAUSEDOWN_DEMO === '1'

const shim = (name: string) => fileURLToPath(new URL(`./src/renderer/demo/shims/${name}.ts`, import.meta.url))
const DEMO_ALIAS = [
    ['path', 'pathe'],
    ['assert', fileURLToPath(new URL('./src/renderer/demo/shims/assert.cjs', import.meta.url))],
    ['os', shim('os')],
    ['fs', shim('fs')],
].map(([name, replacement]) => ({ find: new RegExp(`^(node:)?${name}$`), replacement }))
DEMO_ALIAS.push({ find: /^zlibjs\/bin\/gunzip\.min\.js$/, replacement: shim('gunzip') })

export default defineNuxtConfig({
    compatibilityDate: '2026-11-01',
    srcDir: 'src/renderer',
    ssr: false,
    modules: ['@nuxt/ui', '@pinia/nuxt'],
    css: ['~/assets/css/main.css'],
    alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
    ui: { fonts: false },
    icon: {
        provider: 'none',
        clientBundle: { scan: { globInclude: ['**/*.{vue,ts}'] }, includeCustomCollections: true },
    },
    ...(DEMO ? { buildDir: '.nuxt-demo' } : {}),
    runtimeConfig: { public: { demo: DEMO } },
    app: {
        ...(DEMO ? { baseURL: process.env.CLAUSEDOWN_BASE ?? '/' } : {}),
        head: {
            title: 'ClauseDown',
            htmlAttrs: { lang: 'ja' },
        },
    },
    vite: { plugins: DEMO ? [] : [recordLicenses('renderer')], worker: { format: 'es' }, ...(DEMO ? { resolve: { alias: DEMO_ALIAS } } : {}) },
    devServer: { port: 3000 },
    devtools: { enabled: false },
    telemetry: false,
    nitro: {
        ...(DEMO ? { publicAssets: [{ dir: fileURLToPath(new URL('./node_modules/kuromoji/dict', import.meta.url)), baseURL: '/dict' }] } : {}),
        output: { publicDir: fileURLToPath(new URL(DEMO ? './out/demo' : './out/renderer', import.meta.url)) },
    },
    typescript: {
        typeCheck: false,
        tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } },
    },
})
