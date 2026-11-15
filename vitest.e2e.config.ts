import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// npm run manual:shots で名指ししたときだけ、英語版マニュアルの画面写真を撮るスクリプトも対象にする
const manualShots = process.argv.some((a) => a.includes('manual-shots'))

export default defineConfig({
    resolve: {
        alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
    },
    test: {
        include: ['test/e2e/**/*.e2e.ts', ...(manualShots ? ['scripts/manual-shots.e2e.ts'] : [])],
        testTimeout: 60000,
        hookTimeout: 120000,
        fileParallelism: false,
    },
})
