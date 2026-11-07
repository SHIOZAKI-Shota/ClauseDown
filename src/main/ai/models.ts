import type { AiModel } from '../../shared/api'
import type { AiConfig } from '../../shared/ai-providers'
import { resolveAi } from './provider'
import { client } from './openai-compat'

const TIMEOUT = 10_000

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
}

const byId = (a: AiModel, b: AiModel) => a.id.localeCompare(b.id)

export async function listAiModels(config: AiConfig): Promise<AiModel[]> {
    const r = await resolveAi(config)
    try {
        switch (r.config.provider) {
            case 'anthropic': {
                if (!r.key) return []
                const j = (await getJson('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': r.key, 'anthropic-version': '2023-06-01' })) as {
                    data?: { id: string; display_name?: string }[]
                }
                return (j.data ?? []).map((m) => ({ id: m.id, label: m.display_name }))
            }
            case 'ollama': {
                const origin = new URL(r.base).origin
                const j = (await getJson(`${origin}/api/tags`)) as { models?: { name: string }[] }
                return (j.models ?? []).map((m) => ({ id: m.name })).sort(byId)
            }
            case 'openrouter': {
                const j = (await getJson(`${r.base}/models?supported_parameters=tools`)) as {
                    data?: { id: string; name?: string; supported_parameters?: string[] }[]
                }
                return (j.data ?? [])
                    .filter((m) => !m.supported_parameters || m.supported_parameters.includes('tools'))
                    .map((m) => ({ id: m.id, label: m.name }))
                    .sort(byId)
            }
            case 'github': {
                if (!r.key) return []
                const j = (await getJson('https://models.github.ai/catalog/models', { Authorization: `Bearer ${r.key}` })) as {
                    id: string
                    name?: string
                    capabilities?: string[]
                }[]
                return (Array.isArray(j) ? j : [])
                    .filter((m) => !m.capabilities || m.capabilities.includes('tool-calling'))
                    .map((m) => ({ id: m.id, label: m.name }))
                    .sort(byId)
            }
            case 'openai': {
                const list: AiModel[] = []
                for await (const m of client(r).models.list({ timeout: TIMEOUT })) list.push({ id: m.id })
                return list.sort(byId)
            }
        }
    } catch {
        return []
    }
}
