import { aiPrompts } from '../../shared/ai-prompts'
import { errText } from '../util'
import OpenAI from 'openai'
import { t } from '../../shared/i18n'
import { z } from 'zod'
import type { AiEvent } from '../../shared/api'
import { aiSystem, aiToolUse } from '../../shared/ai-presets'
import { TOOLS, runTool, toolLabel, type ToolContext } from '../ai-tools'
import type { ResolvedAi } from './provider'

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam

const MAX_TURNS = 40

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
        defaultHeaders:
            r.config.provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/SHIOZAKI-Shota/ClauseDown', 'X-Title': 'ClauseDown' } : undefined,
    })
}

export function explainOpenAi(e: unknown, r: ResolvedAi): string {
    const who = r.config.provider === 'ollama' ? 'Ollama' : r.label.split('・')[0]
    const m = t().errors.ai.openai
    if (e instanceof OpenAI.APIConnectionError) {
        return r.config.provider === 'ollama' ? m.ollamaConnection : m.connection(who)
    }
    if (e instanceof OpenAI.AuthenticationError) {
        return r.config.provider === 'github' ? m.githubExpired : m.auth(who)
    }
    if (e instanceof OpenAI.PermissionDeniedError) {
        return r.config.provider === 'github' ? m.githubPermission : m.permission(who, e.message)
    }
    if (e instanceof OpenAI.NotFoundError) return m.modelNotFound(r.model)
    if (e instanceof OpenAI.RateLimitError) return m.rateLimit(who)
    if (e instanceof OpenAI.BadRequestError && /tool|function/i.test(e.message)) {
        return m.noTools(r.model)
    }
    if (e instanceof OpenAI.APIError) return m.api(who, `${e.status ?? ''} ${e.message}`)
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
    const history = sessions.get(session) ?? [{ role: 'system', content: aiSystem() + aiToolUse() }]
    sessions.set(session, history)
    history.push({ role: 'user', content: userText })
    const api = client(r)

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const stream = await api.chat.completions.create({ model: r.model, messages: history, tools: TOOL_DEFS, stream: true }, { signal })
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
            for (const c of used) history.push({ role: 'tool', tool_call_id: c.id, content: aiPrompts().stopped })
            throw new Error(t().errors.ai.tooLong)
        }
        if (finish === 'content_filter') throw new Error(t().errors.ai.refused)
        if (!used.length) return

        const results = await Promise.all(
            used.map(async (c): Promise<Msg> => {
                let input: unknown
                try {
                    input = JSON.parse(c.args || '{}')
                } catch {
                    return { role: 'tool', tool_call_id: c.id, content: aiPrompts().badJson }
                }
                send({ session, type: 'tool', label: toolLabel(c.name, input) })
                try {
                    return { role: 'tool', tool_call_id: c.id, content: await runTool(c.name, input, ctx) }
                } catch (e) {
                    return { role: 'tool', tool_call_id: c.id, content: aiPrompts().toolError(errText(e)) }
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
        messages: [{ role: 'user', content: aiPrompts().ping }],
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
