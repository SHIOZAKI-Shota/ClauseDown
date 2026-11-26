<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import type { AiModel, AiStatus } from '@shared/api'
import { AI_PROVIDERS, OPENAI_PRESETS, aiBaseOf, type AiConfig, type AiProvider } from '@shared/ai-providers'
import { GITHUB_BASE } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const emit = defineEmits<{ status: [AiStatus] }>()
const app = useApp()
const t = useT()
const ask = useConfirm()

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

// AI_PROVIDERS の表示名・説明は画面の言語で変わるので、t を読んで作り直す
const info = computed(() => (void t.value, AI_PROVIDERS[provider.value]))
const providerNote = computed(() =>
	provider.value === 'ollama' && status.value && !status.value.local ? t.value.ai.settings.ollamaLan : info.value.description,
)
const providerItems = computed(() => (void t.value, (Object.keys(AI_PROVIDERS) as AiProvider[]).map((p) => ({ label: AI_PROVIDERS[p].label, value: p }))))
const OTHER = 'other'
const presetItems = computed(() => [...OPENAI_PRESETS.map((p) => ({ label: p.label, value: p.url })), { label: t.value.ai.settings.otherUrl, value: OTHER }])
const preset = ref('')
const config = computed<AiConfig>(() => ({
	provider: provider.value,
	model: model.value.trim() || undefined,
	baseUrl: provider.value === 'openai' || provider.value === 'ollama' ? baseUrl.value.trim() || undefined : undefined,
}))
const githubLogin = computed(() => app.accounts.find((a) => a.base === GITHUB_BASE)?.login)
const modelItems = computed(() =>
	models.value.map((m) => ({ label: m.label && m.label !== m.id ? t.value.ai.settings.modelItem(m.label, m.id) : m.id, value: m.id })),
)

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
async function clearKey() {
	if (
		await ask({
			title: t.value.ai.settings.clearKeyConfirm,
			description: t.value.ai.settings.clearKeyDesc,
			confirmLabel: t.value.ai.settings.clearKey,
			color: 'error',
		})
	)
		await saveKey(true)
}
async function saveKey(clear = false) {
	const s = await app.run(
		() => window.api.setAiKey(provider.value, clear ? '' : key.value, config.value.baseUrl),
		clear ? t.value.ai.settings.keyCleared : t.value.ai.settings.keySaved,
	)
	if (!s) return
	key.value = ''
	setStatus(s)
	void loadModels()
}
async function loginOpenRouter() {
	loggingIn.value = true
	try {
		const s = await app.run(() => window.api.aiLoginOpenRouter(), t.value.ai.settings.openRouterSignedIn, { busy: false })
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
		if (r) app.notify(t.value.ai.settings.reply(r.slice(0, 80)))
	} finally {
		testing.value = false
	}
}
</script>

<template>
	<SettingRow :label="t.ai.settings.provider" :description="providerNote">
		<USelect :model-value="provider" :items="providerItems" class="cd-w-input" @update:model-value="(v) => onProvider(v as AiProvider)" />
	</SettingRow>

	<template v-if="provider === 'openai'">
		<SettingRow :label="t.ai.settings.endpoint" :description="t.ai.settings.endpointDesc">
			<USelect :model-value="preset" :items="presetItems" class="cd-w-small" @update:model-value="(v) => onPreset(String(v))" />
			<UInput v-if="preset === OTHER" v-model="baseUrl" placeholder="https://…/v1" class="cd-w-input" @change="save" />
		</SettingRow>
	</template>
	<SettingRow v-if="provider === 'ollama'" :label="t.ai.settings.ollamaUrl" :description="t.ai.settings.ollamaUrlDesc">
		<UInput v-model="baseUrl" placeholder="http://127.0.0.1:11434/v1" class="cd-w-input" @change="save" />
	</SettingRow>

	<SettingRow
		v-if="info.auth === 'key'"
		:label="provider === 'anthropic' ? t.ai.settings.claudeKey : t.ai.settings.apiKey"
		:description="status?.hasKey ? t.ai.settings.keyStored : provider === 'anthropic' ? t.ai.settings.keyAnthropic : t.ai.settings.keyOther"
	>
		<UInput
			v-model="key"
			:type="showKey ? 'text' : 'password'"
			class="cd-w-input"
			autocomplete="off"
			:placeholder="status?.hasKey ? t.ai.settings.overwrite : provider === 'anthropic' ? 'sk-ant-…' : ''"
		>
			<template #trailing>
				<UButton
					:icon="showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
					size="xs"
					color="neutral"
					variant="link"
					:aria-label="showKey ? t.common.hide : t.common.show"
					@click="showKey = !showKey"
				/>
			</template>
		</UInput>
		<UButton :label="t.common.save" size="sm" color="neutral" variant="outline" :disabled="!key.trim()" @click="saveKey()" />
		<UButton v-if="status?.hasKey" :label="t.ai.settings.clearKey" size="sm" color="error" variant="ghost" @click="clearKey" />
	</SettingRow>
	<SettingRow
		v-if="info.auth === 'oauth'"
		:label="t.ai.settings.openRouterAccount"
		:description="status?.hasKey ? t.ai.settings.openRouterStored : t.ai.settings.openRouterHint"
	>
		<UButton v-if="status?.hasKey" :label="t.ai.settings.logout" size="sm" color="neutral" variant="outline" @click="saveKey(true)" />
		<UButton v-else :label="t.ai.settings.openRouterLogin" icon="i-lucide-log-in" size="sm" :loading="loggingIn" @click="loginOpenRouter" />
	</SettingRow>
	<SettingRow
		v-if="info.auth === 'github'"
		:label="t.ai.settings.githubAccount"
		:description="githubLogin ? t.ai.settings.githubUses(githubLogin) : t.ai.settings.githubNeeded"
	>
		<UButton v-if="!githubLogin" :label="t.ai.settings.openLogin" icon="i-lucide-github" size="sm" color="neutral" variant="outline" @click="goLogin" />
	</SettingRow>

	<SettingRow :label="t.ai.settings.model" :description="provider === 'ollama' ? t.ai.settings.modelOllamaDesc : t.ai.settings.modelDesc">
		<USelect
			v-if="modelItems.length"
			:model-value="model"
			:items="modelItems"
			:placeholder="t.ai.settings.pickFromList"
			class="cd-w-input"
			@update:model-value="(v) => pickModel(String(v))"
		/>
		<UInput v-model="model" :placeholder="info.model ?? t.ai.settings.modelName" class="cd-w-small" @change="save" />
		<UButton
			icon="i-lucide-refresh-cw"
			size="sm"
			color="neutral"
			variant="ghost"
			:loading="loadingModels"
			:title="t.ai.settings.refreshList"
			@click="loadModels"
		/>
	</SettingRow>

	<SettingRow :label="t.ai.settings.status" :description="status?.ready ? t.ai.settings.using(status.label) : (status?.reason ?? '')">
		<UBadge v-if="status?.local" :label="t.ai.settings.local" color="success" variant="subtle" icon="i-lucide-shield-check" />
		<UBadge v-if="status && !status.ready" :label="t.ai.settings.notReady" color="warning" variant="subtle" icon="i-lucide-circle-alert" />
		<UButton :label="t.ai.settings.test" size="sm" color="neutral" variant="outline" :disabled="!status?.ready" :loading="testing" @click="test" />
	</SettingRow>
</template>
