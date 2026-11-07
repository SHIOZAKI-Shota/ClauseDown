export type AiProvider = 'anthropic' | 'openai' | 'ollama' | 'openrouter' | 'github'

export interface AiConfig {
    provider: AiProvider
    model?: string
    baseUrl?: string
}

export const DEFAULT_AI: AiConfig = { provider: 'anthropic' }

export interface AiProviderInfo {
    label: string
    description: string
    base?: string
    model?: string
    auth: 'key' | 'none' | 'oauth' | 'github'
}

export const AI_PROVIDERS: Record<AiProvider, AiProviderInfo> = {
    anthropic: {
        label: 'Claude（Anthropic）',
        description: 'Anthropic の Claude を API キーで使用します。文書の内容は Anthropic に送られます。',
        model: 'claude-opus-5-5',
        auth: 'key',
    },
    openai: {
        label: 'OpenAI・Gemini など（OpenAI 互換）',
        description: 'OpenAI、Google Gemini、DeepSeek、LM Studio など、OpenAI 互換の API を持つサービスを、URL と API キーを指定して使用します。文書の内容はその接続先に送られます。',
        base: 'https://api.openai.com/v1',
        auth: 'key',
    },
    ollama: {
        label: 'Ollama（ローカル の中）',
        description: 'ローカル で動いている Ollama を使用します。API キーは不要で、文書は PC の外に送られません。道具（tools）に対応したモデル（qwen3、llama3.1、gpt-oss など）が必要です。',
        base: 'http://127.0.0.1:11434/v1',
        auth: 'none',
    },
    openrouter: {
        label: 'OpenRouter（ブラウザでログイン）',
        description: 'OpenRouter にブラウザでログインして使用します（API キーの入力は不要です）。Claude・GPT・Gemini などを選べます。料金は OpenRouter に支払います。文書の内容は OpenRouter と、選んだモデルの会社に送られます。',
        base: 'https://openrouter.ai/api/v1',
        auth: 'oauth',
    },
    github: {
        label: 'GitHub Models（GitHub のログイン）',
        description: '設定の「GitHub/GitLab」でログインした GitHub アカウントで使用します。無料枠があり、回数に制限があります。文書の内容は GitHub（Microsoft）に送られます。',
        base: 'https://models.github.ai/inference',
        model: 'openai/gpt-4.1',
        auth: 'github',
    },
}

export const OPENAI_PRESETS: { label: string; url: string }[] = [
    { label: 'OpenAI', url: 'https://api.openai.com/v1' },
    { label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
    { label: 'LM Studio（ローカル）', url: 'http://127.0.0.1:1234/v1' },
]

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

export function safeAiBase(url: unknown): boolean {
    if (typeof url !== 'string') return false
    try {
        const u = new URL(url)
        if (u.username || u.password || u.search || u.hash) return false
        return u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.includes(u.hostname))
    } catch {
        return false
    }
}

export function isLocalBase(url: string): boolean {
    try {
        return LOOPBACK.includes(new URL(url).hostname)
    } catch {
        return false
    }
}

export function cleanAiConfig(raw: unknown): AiConfig {
    const r = (raw ?? {}) as Partial<AiConfig>
    const provider: AiProvider = r.provider && r.provider in AI_PROVIDERS ? r.provider : 'anthropic'
    const out: AiConfig = { provider }
    const model = typeof r.model === 'string' ? r.model.trim().slice(0, 200) : ''
    if (model && /^[\w.:/@+-]+$/.test(model)) out.model = model
    if (provider === 'openai' || provider === 'ollama') {
        const base = typeof r.baseUrl === 'string' ? r.baseUrl.trim().replace(/\/+$/, '') : ''
        if (base && safeAiBase(base)) out.baseUrl = base
    }
    return out
}

export function aiBaseOf(c: AiConfig): string {
    return c.baseUrl ?? AI_PROVIDERS[c.provider].base ?? ''
}

export function aiShortLabel(c: AiConfig): string {
    const name =
        c.provider === 'openai'
            ? (OPENAI_PRESETS.find((p) => p.url === aiBaseOf(c))?.label ?? 'OpenAI 互換')
            : { anthropic: 'Claude', ollama: 'Ollama', openrouter: 'OpenRouter', github: 'GitHub Models' }[c.provider]
    const model = c.model ?? AI_PROVIDERS[c.provider].model
    return model ? `${name}・${model}` : name
}
