import { changedPaths, readAt, readDoc } from './git'
import { t } from '../shared/i18n'
import { aiPrompts } from '../shared/ai-prompts'
import { tryResolve } from './git-base'
import { aiAsk } from './ai-agent'
import { compareSources } from '../shared/article-diff'
import { parseLegal } from '../shared/legal-parser'

const MAX_DIFF = 12000

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
    if (!line) throw new Error(t().errors.ai.noMessage)
    return line.slice(0, 120)
}

export async function suggestVersionMessage(dir: string): Promise<string> {
    const paths = [...(await changedPaths(dir))].filter((p) => p.toLowerCase().endsWith('.md'))
    if (!paths.length) throw new Error(t().errors.git.noChanges)
    const head = await tryResolve(dir, 'HEAD')
    const parts: string[] = []
    for (const p of paths) {
        const before = head ? ((await readAt(dir, 'HEAD', p)) ?? '') : ''
        const after = await readDoc(dir, p).catch(() => '')
        const title = parseLegal(after || before).title || p
        const state = !before ? aiPrompts().newDoc : !after ? aiPrompts().removedDoc : ''
        parts.push(`■ ${title}${state}\n${before && after ? diffText(before, after) : ''}`.trim())
    }
    let diff = parts.join('\n\n')
    if (diff.length > MAX_DIFF) diff = `${diff.slice(0, MAX_DIFF)}\n${aiPrompts().truncated}`
    return firstLine(await aiAsk(aiPrompts().versionSystem, aiPrompts().versionPrompt(diff)))
}
