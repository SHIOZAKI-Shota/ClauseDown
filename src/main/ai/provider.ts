import { createHash } from 'node:crypto'
import { AI_PROVIDERS, aiBaseOf, aiShortLabel, cleanAiConfig, isLocalBase, safeAiBase, type AiConfig, type AiProvider } from '../../shared/ai-providers'
import { GITHUB_BASE } from '../../shared/forge'
import { getToken, loadSecret, loadSettings, type SecretName } from '../settings'
import { isEnabled } from '../../shared/experiments'

export interface ResolvedAi {
    config: AiConfig
    kind: 'anthropic' | 'openai'
    base: string
    key: string | null
    model: string
    label: string
    local: boolean
    ready: boolean
    reason?: string
}

export function keyName(provider: AiProvider, base: string): SecretName | null {
    if (provider === 'anthropic') return 'ai-key'
    if (provider === 'openrouter') return 'ai-key-openrouter'
    if (provider === 'openai') return `ai-key-openai-${createHash('sha256').update(base).digest('hex').slice(0, 16)}`
    return null
}

export async function resolveAi(override?: AiConfig): Promise<ResolvedAi> {
    const settings = await loadSettings()
    const rules = { lan: isEnabled(settings, 'lanAi') }
    const config = cleanAiConfig(override ?? settings.ai, rules)
    const info = AI_PROVIDERS[config.provider]
    const base = aiBaseOf(config)
    const model = config.model ?? info.model ?? ''
    const name = keyName(config.provider, base)
    let key: string | null = null
    if (name) key = await loadSecret(name)
    else if (config.provider === 'github') key = await getToken(GITHUB_BASE)
    const r: ResolvedAi = {
        config,
        kind: config.provider === 'anthropic' ? 'anthropic' : 'openai',
        base,
        key,
        model,
        label: aiShortLabel(config),
        local: config.provider !== 'anthropic' && isLocalBase(base),
        ready: true,
    }
    const fail = (reason: string) => ({ ...r, ready: false, reason })
    if (config.provider !== 'anthropic' && !safeAiBase(base, rules))
        return fail(
            rules.lan
                ? '接続先の URL は https か、ローカル の中（http://127.0.0.1）か LAN 内（http://192.168.x.x など）にしてください'
                : '接続先の URL は https か、ローカル の中（http://127.0.0.1）にしてください',
        )
    if (info.auth === 'key' && !key) {
        return fail(config.provider === 'anthropic' ? 'Claude の API キーが設定されていません' : 'この接続先の API キーが設定されていません')
    }
    if (info.auth === 'oauth' && !key) return fail('OpenRouter にログインしていません')
    if (info.auth === 'github' && !key) return fail('GitHub にログインしていません（設定の「GitHub/GitLab」）')
    if (!model) return fail('使うモデルを選んでください')
    return r
}
