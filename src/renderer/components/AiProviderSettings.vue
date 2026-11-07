<script setup lang="ts">
import type { AiModel, AiStatus } from '@shared/api'
import { AI_PROVIDERS, OPENAI_PRESETS, aiBaseOf, type AiConfig, type AiProvider } from '@shared/ai-providers'
import { GITHUB_BASE } from '@shared/forge'
import { useApp } from '~/stores/app'

const emit = defineEmits<{ status: [AiStatus] }>()
const app = useApp()

const status = ref<AiStatus | null>(null)
const provider = ref<AiProvider>('anthropic')
const baseUrl = ref('')
const model = ref('')
const key = ref('')
const showKey = ref(false)
const models = ref<AiModel[]>([])
const loadingModels = ref(false)
const testing = ref(false)
const loggingIn = ref(false)

const info = computed(() => AI_PROVIDERS[provider.value])
const providerItems = (Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => ({ label: AI_PROVIDERS[p].label, value: p }))
const OTHER = 'other'
const presetItems = [...OPENAI_PRESETS.map((p) => ({ label: p.label, value: p.url })), { label: 'その他（URL を入力）', value: OTHER }]
const preset = ref('')
const config = computed<AiConfig>(() => ({
    provider: provider.value,
    model: model.value.trim() || undefined,
    baseUrl: provider.value === 'openai' || provider.value === 'ollama' ? baseUrl.value.trim() || undefined : undefined,
}))
const githubLogin = computed(() => app.accounts.find((a) => a.base === GITHUB_BASE)?.login)
const modelItems = computed(() => models.value.map((m) => ({ label: m.label && m.label !== m.id ? `${m.label}（${m.id}）` : m.id, value: m.id })))

function setStatus(s: AiStatus) {
    status.value = s
    emit('status', s)
}

onMounted(async () => {
    const s = await window.api.aiStatus()
    provider.value = s.config.provider
    baseUrl.value = s.config.baseUrl ?? ''
    model.value = s.config.model ?? ''
    preset.value = OPENAI_PRESETS.some((p) => p.url === aiBaseOf(s.config)) ? aiBaseOf(s.config) : s.config.provider === 'openai' ? OTHER : ''
    setStatus(s)
    void loadModels()
})

async function save() {
    const s = await app.run(() => window.api.setAiConfig(toRaw(config.value)))
    if (s) setStatus(s)
}
async function onProvider(p: AiProvider) {
    provider.value = p
    baseUrl.value = ''
    model.value = ''
    key.value = ''
    models.value = []
    preset.value = p === 'openai' ? OPENAI_PRESETS[0].url : ''
    if (p === 'openai') baseUrl.value = OPENAI_PRESETS[0].url
    await save()
    void loadModels()
}
async function onPreset(v: string) {
    preset.value = v
    baseUrl.value = v === OTHER ? '' : v
    model.value = ''
    models.value = []
    await save()
    void loadModels()
}
async function loadModels() {
    loadingModels.value = true
    try {
        models.value = await window.api.listAiModels(toRaw(config.value))
    } finally {
        loadingModels.value = false
    }
}
async function pickModel(v: string) {
    model.value = v
    await save()
}
async function saveKey(clear = false) {
    const s = await app.run(
        () => window.api.setAiKey(provider.value, clear ? '' : key.value, config.value.baseUrl),
        clear ? 'キーを消しました' : 'キーを保存しました',
    )
    if (!s) return
    key.value = ''
    setStatus(s)
    void loadModels()
}
async function loginOpenRouter() {
    loggingIn.value = true
    try {
        const s = await app.run(() => window.api.aiLoginOpenRouter(), 'OpenRouter にログインしました')
        if (s) {
            setStatus(s)
            void loadModels()
        }
    } finally {
        loggingIn.value = false
    }
}
const goLogin = () => app.openSettings('setup', 'remote')
async function test() {
    testing.value = true
    try {
        const r = await app.run(() => window.api.testAi())
        if (r) app.notify(`AI の応答：${r.slice(0, 80)}`)
    } finally {
        testing.value = false
    }
}
</script>

<template>
    <SettingRow label="使う AI" :description="info.description">
        <USelect :model-value="provider" :items="providerItems" class="cd-w-input"
            @update:model-value="(v) => onProvider(v as AiProvider)" />
    </SettingRow>

    <template v-if="provider === 'openai'">
        <SettingRow label="接続先" description="Gemini は Google AI Studio、DeepSeek は DeepSeek のサイトで発行したキーを使用します。">
            <USelect :model-value="preset" :items="presetItems" class="cd-w-small"
                @update:model-value="(v) => onPreset(String(v))" />
            <UInput v-if="preset === OTHER" v-model="baseUrl" placeholder="https://…/v1" class="cd-w-input"
                @change="save" />
        </SettingRow>
    </template>
    <SettingRow v-if="provider === 'ollama'" label="Ollama の場所"
        description="空欄なら http://127.0.0.1:11434 を使います。ふつうは空欄のままで構いません。">
        <UInput v-model="baseUrl" placeholder="http://127.0.0.1:11434/v1" class="cd-w-input" @change="save" />
    </SettingRow>

    <SettingRow v-if="info.auth === 'key'" :label="provider === 'anthropic' ? 'Claude API キー' : 'API キー'"
        :description="status?.hasKey ? '保存してあります（ローカル の中で暗号化しています）。このキーは、この接続先にだけ送ります。' : provider === 'anthropic' ? 'Anthropic の Console で発行したキーを入力してください。' : 'その接続先で発行したキーを入力してください。'">
        <UInput v-model="key" :type="showKey ? 'text' : 'password'" class="cd-w-input" autocomplete="off"
            :placeholder="status?.hasKey ? '入力すると上書きします' : provider === 'anthropic' ? 'sk-ant-…' : ''">
            <template #trailing>
                <UButton :icon="showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'" size="xs" color="neutral" variant="link"
                    @click="showKey = !showKey" />
            </template>
        </UInput>
        <UButton label="保存" size="sm" color="neutral" variant="outline" :disabled="!key.trim()" @click="saveKey()" />
        <UButton v-if="status?.hasKey" label="消す" size="sm" color="error" variant="ghost" @click="saveKey(true)" />
    </SettingRow>
    <SettingRow v-if="info.auth === 'oauth'" label="OpenRouter のアカウント"
        :description="status?.hasKey ? 'ログインしてあります（受け取ったキーを、ローカル の中で暗号化しています）。' : 'ブラウザで OpenRouter にログインすると、このアプリ用のキーが発行されます。'">
        <UButton v-if="status?.hasKey" label="ログアウト" size="sm" color="neutral" variant="outline"
            @click="saveKey(true)" />
        <UButton v-else label="OpenRouter でログイン" icon="i-lucide-log-in" size="sm" :loading="loggingIn"
            @click="loginOpenRouter" />
    </SettingRow>
    <SettingRow v-if="info.auth === 'github'" label="GitHub のアカウント"
        :description="githubLogin ? `${githubLogin} のログインを使用します。` : '設定の「GitHub/GitLab」で GitHub にログインしてください。'">
        <UButton v-if="!githubLogin" label="ログインの設定を開く" icon="i-lucide-github" size="sm" color="neutral"
            variant="outline" @click="goLogin" />
    </SettingRow>

    <SettingRow label="モデル"
        :description="provider === 'ollama' ? 'インストール済みのモデルから選びます（インストールは ollama pull qwen3 など）。ツール呼び出し（tools）に対応したモデルが必要です。' : '一覧から選ぶか、名前を直接入力します。空欄なら既定のモデルを使用します。'">
        <USelect v-if="modelItems.length" :model-value="model" :items="modelItems" placeholder="一覧から選ぶ"
            class="cd-w-input" @update:model-value="(v) => pickModel(String(v))" />
        <UInput v-model="model" :placeholder="info.model ?? 'モデル名'" class="cd-w-small" @change="save" />
        <UButton icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="ghost" :loading="loadingModels"
            title="一覧を更新" @click="loadModels" />
    </SettingRow>

    <SettingRow label="状態" :description="status?.ready ? `${status.label} を使用します。` : (status?.reason ?? '')">
        <UBadge v-if="status?.local" label="文書を PC の外に送信しません" color="success" variant="subtle"
            icon="i-lucide-shield-check" />
        <UBadge v-if="status && !status.ready" label="まだ使えません" color="warning" variant="subtle"
            icon="i-lucide-circle-alert" />
        <UButton label="接続を試す" size="sm" color="neutral" variant="outline" :disabled="!status?.ready" :loading="testing"
            @click="test" />
    </SettingRow>
</template>
