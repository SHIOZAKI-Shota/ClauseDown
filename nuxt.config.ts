import { fileURLToPath } from 'node:url'
import { recordLicenses } from './scripts/license-plugin.mjs'

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
    app: {
        head: {
            title: 'ClauseDown',
            htmlAttrs: { lang: 'ja' },
        },
    },
    vite: { plugins: [recordLicenses('renderer')] },
    devServer: { port: 3000 },
    devtools: { enabled: false },
    telemetry: false,
    nitro: { output: { publicDir: fileURLToPath(new URL('./out/renderer', import.meta.url)) } },
    typescript: {
        typeCheck: false,
        tsConfig: { compilerOptions: { noUncheckedIndexedAccess: false } },
    },
})
