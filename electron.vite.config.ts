import { defineConfig } from 'electron-vite'
import { recordLicenses } from './scripts/license-plugin.mjs'

// package.json の dependencies は、アプリに node_modules のまま入る（校正の規則のように、実行中に名前で読み込むもの）。
// それ以外の部品は devDependencies に書き、ここで index.js にまとめて入れる。使う部分だけが入るので、アプリが小さくなる。
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
