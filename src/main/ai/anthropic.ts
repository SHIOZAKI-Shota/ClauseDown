import { aiPrompts } from '../../shared/ai-prompts'
import { errText } from '../util'
import Anthropic from '@anthropic-ai/sdk'
import { t } from '../../shared/i18n'
import { z } from 'zod'
import type { AiEvent } from '../../shared/api'
import { aiSystem } from '../../shared/ai-presets'
import { TOOLS, runTool, toolLabel, type ToolContext } from '../ai-tools'

const MAX_TURNS = 40

const sessions = new Map<string, Anthropic.Beta.BetaMessageParam[]>()

const TOOL_DEFS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>
    return {
        name: t.name,
        description: t.description,
        input_schema: schema as Anthropic.Beta.BetaTool['input_schema'],
        eager_input_streaming: true,
    }
})

export function explainAnthropic(e: unknown): string {
    const m = t().errors.ai.anthropic
    if (e instanceof Anthropic.AuthenticationError) return m.auth
    if (e instanceof Anthropic.PermissionDeniedError) return m.permission
    if (e instanceof Anthropic.NotFoundError) return m.notFound
    if (e instanceof Anthropic.RateLimitError) return m.rateLimit
    if (e instanceof Anthropic.APIConnectionTimeoutError) return m.timeout
    if (e instanceof Anthropic.APIConnectionError) {
        const causes: string[] = []
        for (let c: unknown = e.cause; c && causes.length < 3; c = (c as { cause?: unknown }).cause) {
            const { code, message } = c as { code?: string; message?: string }
            causes.push([code, message].filter(Boolean).join(' '))
        }
        console.error('[anthropic] connection error', e)
        return m.connection(causes.join(' / '))
    }
    if (e instanceof Anthropic.InternalServerError) return m.server
    if (e instanceof Anthropic.APIError) return m.api(`${e.status ?? ''} ${e.message}`)
    return (e as Error)?.message ?? String(e)
}

export const isAnthropicAbort = (e: unknown) => e instanceof Anthropic.APIUserAbortError

export function resetAnthropic(session: string) {
    sessions.delete(session)
}

export async function runAnthropic(
    key: string,
    model: string,
    session: string,
    userText: string,
    send: (e: AiEvent) => void,
    ctx: ToolContext,
    signal: AbortSignal,
): Promise<void> {
    const history = sessions.get(session) ?? []
    sessions.set(session, history)
    history.push({ role: 'user', content: userText })

    const client = new Anthropic({ apiKey: key })
    let jsonRetries = 0
    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const stream = client.beta.messages.stream(
            {
                model,
                max_tokens: 64000,
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                thinking: { type: 'adaptive', display: 'summarized' },
                output_config: { effort: 'high' },
                cache_control: { type: 'ephemeral' },
                system: aiSystem(),
                tools: TOOL_DEFS,
                messages: history,
            },
            { signal },
        )
        stream.on('text', (text) => send({ session, type: 'text', text }))
        stream.on('thinking', (text) => send({ session, type: 'thinking', text }))
        stream.on('streamEvent', (ev) => {
            if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') send({ session, type: 'thinking', text: '\n\n' })
        })

        let message: Anthropic.Beta.BetaMessage
        try {
            message = await stream.finalMessage()
            jsonRetries = 0
        } catch (e) {
            if (e instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw e
            continue
        }

        history.push({ role: 'assistant', content: message.content })
        const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
            // 実行しなかった関数にも結果を返さないと次履歴を受け付けない
            if (uses.length) {
                history.push({
                    role: 'user',
                    content: uses.map((u) => ({
                        type: 'tool_result' as const,
                        tool_use_id: u.id,
                        is_error: true,
                        content: aiPrompts().stopped,
                    })),
                })
            }
            throw new Error(message.stop_reason === 'refusal' ? t().errors.ai.refused : t().errors.ai.tooLong)
        }
        if (message.stop_reason === 'pause_turn') continue
        if (!uses.length) return

        const results = await Promise.all(
            uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
                send({ session, type: 'tool', label: toolLabel(u.name, u.input) })
                try {
                    return { type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input, ctx) }
                } catch (e) {
                    return { type: 'tool_result', tool_use_id: u.id, is_error: true, content: errText(e) }
                }
            }),
        )
        history.push({ role: 'user', content: results })
        if (signal.aborted) return
    }
}

export async function testAnthropic(key: string, model: string): Promise<string> {
    const client = new Anthropic({ apiKey: key })
    const m = await client.messages.create({ model, max_tokens: 200, messages: [{ role: 'user', content: aiPrompts().ping }] })
    return m.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim()
}

export async function askAnthropic(key: string, model: string, system: string, prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey: key })
    const m = await client.messages.create({ model, max_tokens: 400, system, messages: [{ role: 'user', content: prompt }] })
    return m.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim()
}
