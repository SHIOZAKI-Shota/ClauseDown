import { defineConfig } from 'electron-vite'
import { recordLicenses } from './scripts/license-plugin.mjs'

export default defineConfig({
    main: {
        plugins: [recordLicenses('main')],
        build: {
            rollupOptions: { input: { index: 'src/main/index.ts', 'proofread-worker': 'src/main/proofread-worker.ts' } },
        },
    },
    preload: {
        plugins: [recordLicenses('preload')],
        build: {
            rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
        },
    },
})
