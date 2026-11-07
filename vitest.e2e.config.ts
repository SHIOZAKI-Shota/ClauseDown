import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: {
        alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
    },
    test: {
        include: ['test/e2e/**/*.e2e.ts'],
        testTimeout: 60000,
        hookTimeout: 120000,
        fileParallelism: false,
    },
})
