import OpenAI from 'openai'
import { z } from 'zod'
import type { AiEvent } from '../../shared/api'
import { AI_SYSTEM } from '../../shared/ai-presets'
import { TOOLS, runTool, toolLabel, type ToolContext } from '../ai-tools'
import type { ResolvedAi } from './provider'

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

const MAX_TURNS = 40

const EXTRA = `

## 道具の使い方
- 文書の中身は推測せず、必ず read_doc などの道具で読んでから答えてください
- 文書を書き換えるときは、本文に書き換え後の文書を書かずに、edit_doc などの道具を呼んでください`

const sessions = new Map<string, Msg[]>()

const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((t) => {
    const { $schema: _drop, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>
    return { type: 'function', function: { name: t.name, description: t.description, parameters } }
})

export function client(r: ResolvedAi): OpenAI {
    return new OpenAI({
        // キーが空だとSDKが止まるのでOllama・LMStudioにも仮値を挿入
        apiKey: r.key ?? 'none',
        baseURL: r.base,
        maxRetries: 1,
        timeout: 10 * 60 * 1000,
        defaultHeaders: r.config.provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/SHIOZAKI-Shota/ClauseDown', 'X-Title': 'ClauseDown' } : undefined,
    })
}

export function explainOpenAi(e: unknown, r: ResolvedAi): string {
    const who = r.config.provider === 'ollama' ? 'Ollama' : r.label.split('・')[0]
    if (e instanceof OpenAI.APIConnectionError) {
        return r.config.provider === 'ollama'
            ? 'Ollama に接続できません。Ollama を起動しているか確かめてください'
            : `${who} に接続できません。インターネットの接続と、接続先の URL を確かめてください`
    }
    if (e instanceof OpenAI.AuthenticationError) {
        return r.config.provider === 'github' ? 'GitHub のログインの期限が切れています。設定の「GitHub/GitLab」でログインし直してください' : `${who} の API キーが正しくありません。設定の「AI」で入れ直してください`
    }
    if (e instanceof OpenAI.PermissionDeniedError) {
        return r.config.provider === 'github'
            ? 'GitHub Models を使う権限がありません（GitHub のアカウントや組織の設定で、GitHub Models が使えるか確かめてください）'
            : `${who} を使う権限がありません（${e.message}）`
    }
    if (e instanceof OpenAI.NotFoundError) return `モデル「${r.model}」が見つかりません。設定の「AI」でモデルを選び直してください`
    if (e instanceof OpenAI.RateLimitError) return `${who} の利用回数・残高の上限に達したか、混み合っています。少し待つか、プランや残高を確かめてください`
    if (e instanceof OpenAI.BadRequestError && /tool|function/i.test(e.message)) {
        return `モデル「${r.model}」は道具（tools）を使えないため、文書を読んだり書き換えたりできません。道具に対応したモデルを選んでください`
    }
    if (e instanceof OpenAI.APIError) return `${who} の呼び出しに失敗しました（${e.status ?? ''} ${e.message}）`
    return (e as Error)?.message ?? String(e)
}

export const isOpenAiAbort = (e: unknown) => e instanceof OpenAI.APIUserAbortError

export function resetOpenAi(session: string) {
    sessions.delete(session)
}

interface Call {
    id: string
    name: string
    args: string
}

export async function runOpenAi(
    r: ResolvedAi,
    session: string,
    userText: string,
    send: (e: AiEvent) => void,
    ctx: ToolContext,
    signal: AbortSignal,
): Promise<void> {
    const history = sessions.get(session) ?? [{ role: 'system', content: AI_SYSTEM + EXTRA }]
    sessions.set(session, history)
    history.push({ role: 'user', content: userText })
    const api = client(r)

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const stream = await api.chat.completions.create(
            { model: r.model, messages: history, tools: TOOL_DEFS, stream: true },
            { signal },
        )
        let text = ''
        let finish: string | null = null
        const calls: Call[] = []
        for await (const chunk of stream) {
            const choice = chunk.choices?.[0]
            if (!choice) continue
            const d = choice.delta
            if (d?.content) {
                text += d.content
                send({ session, type: 'text', text: d.content })
            }
            for (const tc of d?.tool_calls ?? []) {
                const i = tc.index ?? calls.length
                const c = (calls[i] ??= { id: '', name: '', args: '' })
                if (tc.id) c.id = tc.id
                if (tc.function?.name) c.name += tc.function.name
                if (tc.function?.arguments) c.args += tc.function.arguments
            }
            if (choice.finish_reason) finish = choice.finish_reason
        }
        const used = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${turn}_${i}` }))
        history.push({
            role: 'assistant',
            content: text || null,
            ...(used.length
                ? { tool_calls: used.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })) }
                : {}),
        })
        if (finish === 'length') {
            for (const c of used) history.push({ role: 'tool', tool_call_id: c.id, content: '途中で止まったため実行していません' })
            throw new Error('回答が長すぎて途中で切れました。範囲を絞って指示してください')
        }
        if (finish === 'content_filter') throw new Error('この依頼には AI が回答できませんでした。言い方を変えてお試しください')
        if (!used.length) return

        const results = await Promise.all(
            used.map(async (c): Promise<Msg> => {
                let input: unknown
                try {
                    input = JSON.parse(c.args || '{}')
                } catch {
                    return { role: 'tool', tool_call_id: c.id, content: '道具の入力が JSON として読めませんでした。正しい JSON でもう一度呼んでください' }
                }
                send({ session, type: 'tool', label: toolLabel(c.name, input) })
                try {
                    return { role: 'tool', tool_call_id: c.id, content: await runTool(c.name, input, ctx) }
                } catch (e) {
                    return { role: 'tool', tool_call_id: c.id, content: `エラー：${(e as Error).message}` }
                }
            }),
        )
        history.push(...results)
        if (signal.aborted) return
    }
}

export async function testOpenAi(r: ResolvedAi): Promise<string> {
    const res = await client(r).chat.completions.create({
        model: r.model,
        messages: [{ role: 'user', content: '「接続できました」とだけ答えてください。' }],
    })
    return (res.choices[0]?.message?.content ?? '').trim()
}

export async function askOpenAi(r: ResolvedAi, system: string, prompt: string): Promise<string> {
    const res = await client(r).chat.completions.create({
        model: r.model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
        ],
    })
    return (res.choices[0]?.message?.content ?? '').trim()
}
