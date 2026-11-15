import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// 画面に出る文字は辞書（src/shared/i18n）に置く。ここに日本語が戻ってきたら知らせる
const ROOT = join(import.meta.dirname, '..')
const JP = /[ぁ-んァ-ヶ一-龠]/

// 文書の中身・日本の法令向けの規則・git の名前・AI に読ませる説明など、画面の言語と関係ないもの
const WHOLE_FILES = [
    'src/main/proofread-legal.ts',
    'src/main/proofread-core.ts',
    'src/main/samples.ts',
    'src/main/houritsu.ts',
    'src/main/ai-tools.ts',
    'src/renderer/demo/seed.ts',
    'src/renderer/demo/seed-kit.ts',
    'src/renderer/demo/seed-en.ts',
    'src/renderer/demo/shims/assert.cjs',
    'src/renderer/components/StyleEditor.vue',
]
const ALLOWED_LINES = [
    /施行\/|案\/|納品\//, // git のタグ・ブランチの名前
    /施行日: /, // 版のメッセージに書く施行日の印（読み取りに使う）
    /'現行版'/, // 現行版の名前と比べる（古い名前も受ける）
    /修正依頼/, // GitLab のメモから読み戻す印
    /serviceName/,
    /で解決しました|版 \|/, // 課題のコメントを読み取る正規表現
    /\.test\(|\/\^|RegExp/, // 日本語の文書を読み取る正規表現
    /第\$\{|\$\{label\} 削除/, // 文書の言語で決まる番号
    /cd-hint|この法律は、〇〇/, // 設定の見本（文書の中身）
    /USER = |userFor = /, // デモの利用者の名前
]

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? files(p) : /\.(ts|vue|cjs)$/.test(n) ? [p] : []
    })
}

describe('画面の文字を辞書に置く', () => {
    it('renderer と main に、辞書を通さない日本語が残っていない', () => {
        const left: string[] = []
        for (const p of [...files(join(ROOT, 'src/renderer')), ...files(join(ROOT, 'src/main'))]) {
            const rel = relative(ROOT, p).replaceAll('\\', '/')
            if (WHOLE_FILES.includes(rel)) continue
            readFileSync(p, 'utf8')
                .split('\n')
                .forEach((line, i) => {
                    const code = line.replace(/\/\/.*$/, '').replace(/<!--.*?-->/g, '')
                    if (!JP.test(code) || /^\s*(\*|\/\*)/.test(code) || /console\.(log|warn|error)/.test(code)) return
                    if (ALLOWED_LINES.some((re) => re.test(code))) return
                    left.push(`${rel}:${i + 1}: ${line.trim()}`)
                })
        }
        expect(left).toEqual([])
    })
})
