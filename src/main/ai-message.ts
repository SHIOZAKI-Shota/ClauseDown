import { changedPaths, readAt, readDoc } from './git'
import { tryResolve } from './git-base'
import { aiAsk } from './ai-agent'
import { compareSources } from '../shared/article-diff'
import { parseLegal } from '../shared/legal-parser'

const MAX_DIFF = 12000

const SYSTEM = `あなたは、法令・契約書・規程の改定履歴を書く担当者です。
渡された変更から、版の説明を日本語で 1 行だけ書きます。
- 60 字程度まで。句点は付けない
- 「第12条 契約期間を2年に変更」のように、どの条をどう変えたかを書く
- 変更が多いときは主なものを書き、残りは「ほか」とまとめる
- 新しい文書なら「○○を作成」、消した文書なら「○○を削除」
- 説明の文だけを返す。前置き・引用符・箇条書きの記号は付けない`

function diffText(before: string, after: string): string {
    return compareSources(before, after)
        .filter((r) => r.status !== 'same')
        .map((r) => r.inline.map((p) => (p.op === 'same' ? p.text : p.op === 'add' ? `{+${p.text}+}` : `[-${p.text}-]`)).join(''))
        .join('\n\n')
}

function firstLine(text: string): string {
    const line = text
        .split('\n')
        .map((l) =>
            l
                .trim()
                .replace(/^[-*・]\s*/, '')
                .replace(/。+$/, '')
                .replace(/^[「『"']+|[」』"']+$/g, '')
                .replace(/。+$/, ''),
        )
        .find(Boolean)
    if (!line) throw new Error('AI から説明が返りませんでした')
    return line.slice(0, 120)
}

export async function suggestVersionMessage(dir: string): Promise<string> {
    const paths = [...(await changedPaths(dir))].filter((p) => p.toLowerCase().endsWith('.md'))
    if (!paths.length) throw new Error('前の版から変更がありません')
    const head = await tryResolve(dir, 'HEAD')
    const parts: string[] = []
    for (const p of paths) {
        const before = head ? ((await readAt(dir, 'HEAD', p)) ?? '') : ''
        const after = await readDoc(dir, p).catch(() => '')
        const title = parseLegal(after || before).title || p
        const state = !before ? '（新しい文書）' : !after ? '（消した文書）' : ''
        parts.push(`■ ${title}${state}\n${before && after ? diffText(before, after) : ''}`.trim())
    }
    let diff = parts.join('\n\n')
    if (diff.length > MAX_DIFF) diff = `${diff.slice(0, MAX_DIFF)}\n（以下略）`
    const prompt = `次の変更の、版の説明を 1 行で書いてください。[-…-] は消した文字、{+…+} は足した文字です。\n\n${diff}`
    return firstLine(await aiAsk(SYSTEM, prompt))
}
