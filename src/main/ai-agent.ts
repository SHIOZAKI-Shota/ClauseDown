import type { AiEvent, AiRunInput } from '../shared/api'
import type { ToolContext } from './ai-tools'
import { loadSettings } from './settings'
import * as g from './git'
import { resolveAi } from './ai/provider'
import { askAnthropic, explainAnthropic, isAnthropicAbort, resetAnthropic, runAnthropic, testAnthropic } from './ai/anthropic'
import { askOpenAi, explainOpenAi, isOpenAiAbort, resetOpenAi, runOpenAi, testOpenAi } from './ai/openai-compat'

const running = new Map<string, AbortController>()
const sessionTarget = new Map<string, string>()

function forget(session: string) {
    resetAnthropic(session)
    resetOpenAi(session)
    sessionTarget.delete(session)
}

export async function aiRun(dir: string, input: AiRunInput, send: (e: AiEvent) => void, changed: ToolContext['changed']): Promise<void> {
    const { session } = input
    if (running.has(session)) throw new Error('AI が作業中です。作業が終わるのを待つか、止めてから指示してください')
    const r = await resolveAi()
    if (!r.ready) throw new Error(`${r.reason}。設定の「AI」で設定してください`)
    const repo = (await loadSettings()).repos.find((x) => x.dir === dir)
    if (!repo) throw new Error('リポジトリが登録されていません')

    const target = `${r.config.provider}|${r.base}|${r.model}`
    if (sessionTarget.get(session) !== target) {
        forget(session)
        sessionTarget.set(session, target)
    }

    const branch = await g.currentLabel(dir)
    const context = [
        `開いている文書：リポジトリ「${repo.name}」の ${input.path}（作業中：${branch}）`,
        input.selection ? `エディタで選んでいる部分：\n\`\`\`\n${input.selection}\n\`\`\`` : '',
    ]
        .filter(Boolean)
        .join('\n')
    const userText = `${context}\n\n${input.instruction}`

    const ac = new AbortController()
    running.set(session, ac)
    const ctx: ToolContext = { by: 'ai', changed }
    try {
        if (r.kind === 'anthropic') await runAnthropic(r.key!, r.model, session, userText, send, ctx, ac.signal)
        else await runOpenAi(r, session, userText, send, ctx, ac.signal)
        send({ session, type: 'done' })
    } catch (e) {
        if (ac.signal.aborted || isAnthropicAbort(e) || isOpenAiAbort(e)) send({ session, type: 'done' })
        else send({ session, type: 'error', message: r.kind === 'anthropic' ? explainAnthropic(e) : explainOpenAi(e, r) })
    } finally {
        running.delete(session)
    }
}

export async function aiStop(session: string) {
    running.get(session)?.abort()
}

export async function aiReset(session: string) {
    running.get(session)?.abort()
    forget(session)
}

export async function testAi(): Promise<string> {
    const r = await resolveAi()
    if (!r.ready) throw new Error(r.reason)
    try {
        const text = r.kind === 'anthropic' ? await testAnthropic(r.key!, r.model) : await testOpenAi(r)
        return text || '（回答が空でした）'
    } catch (e) {
        throw new Error(r.kind === 'anthropic' ? explainAnthropic(e) : explainOpenAi(e, r))
    }
}

export async function aiAsk(system: string, prompt: string): Promise<string> {
    const r = await resolveAi()
    if (!r.ready) throw new Error(r.reason)
    try {
        return r.kind === 'anthropic' ? await askAnthropic(r.key!, r.model, system, prompt) : await askOpenAi(r, system, prompt)
    } catch (e) {
        throw new Error(r.kind === 'anthropic' ? explainAnthropic(e) : explainOpenAi(e, r))
    }
}
