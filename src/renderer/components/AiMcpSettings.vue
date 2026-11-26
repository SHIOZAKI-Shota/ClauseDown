<script setup lang="ts">
import { DEFAULT_MCP_PORT, type AiStatus, type DesktopStatus } from '@shared/api'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const emit = defineEmits<{ saved: [] }>()
const app = useApp()
const t = useT()
const st = computed(() => t.value.settings)
const ai = ref<AiStatus | null>(null)
const mcpEnabled = ref(app.settings?.mcp?.enabled ?? false)
const mcpPort = ref(app.settings?.mcp?.port ?? DEFAULT_MCP_PORT)
const mcpToken = ref('')
const showMcpToken = ref(false)
const desktop = ref<DesktopStatus | null>(null)
const refreshDesktop = async () => (desktop.value = await window.api.desktopStatus().catch(() => null))
onMounted(async () => {
	if (isDemo()) return
	ai.value = await window.api.aiStatus()
	if (mcpEnabled.value) mcpToken.value = await window.api.getMcpToken()
	void refreshDesktop()
})
const desktopText = computed(() => (desktop.value ? (desktop.value.error ?? st.value.mcp.desktopText[desktop.value.state]) : ''))
async function registerDesktop() {
	const s = await app.run(() => window.api.registerDesktop(), st.value.mcp.registerDone)
	if (s) desktop.value = s
}
async function unregisterDesktop() {
	const s = await app.run(() => window.api.unregisterDesktop(), st.value.mcp.unregisterDone)
	if (s) desktop.value = s
}
async function applyMcp() {
	const s = await app.run(() => window.api.setMcp({ enabled: mcpEnabled.value, port: Number(mcpPort.value) }))
	if (!s) return
	ai.value = s
	app.settings = { ...app.settings!, mcp: { enabled: mcpEnabled.value, port: Number(mcpPort.value) } }
	if (mcpEnabled.value) mcpToken.value = await window.api.getMcpToken()
	if (s.mcp.error) app.notify(s.mcp.error, true)
	else emit('saved')
}
async function regenerateToken() {
	const token = await app.run(() => window.api.regenerateMcpToken(), st.value.mcp.regenerated)
	if (token) mcpToken.value = token
}
const mcpUrl = computed(() => ai.value?.mcp.url || `http://127.0.0.1:${mcpPort.value}/mcp`)
const claudeCommand = computed(() => `claude mcp add --transport http clausedown ${mcpUrl.value} --header "Authorization: Bearer ${mcpToken.value}"`)
async function copy(text: string, what: string) {
	await app.copy(text, st.value.copied(what))
}
</script>

<template>
	<AiProviderSettings @status="(s) => (ai = s)" />
	<SettingRow :label="t.settings.mcp.enable" :description="t.settings.mcp.enableDesc">
		<USwitch v-model="mcpEnabled" @update:model-value="applyMcp" />
	</SettingRow>
	<template v-if="mcpEnabled">
		<SettingRow :label="t.settings.mcp.port" :description="t.settings.mcp.portDesc">
			<UInput v-model.number="mcpPort" type="number" class="cd-w-small" @change="applyMcp" />
			<UBadge v-if="ai?.mcp.running" :label="t.settings.mcp.listening" color="success" variant="subtle" icon="i-lucide-radio" />
			<UBadge v-else-if="ai?.mcp.error" :label="t.settings.mcp.cannotStart" color="error" variant="subtle" icon="i-lucide-circle-alert" />
		</SettingRow>
		<SettingRow :label="t.settings.mcp.token" :description="t.settings.mcp.tokenDesc">
			<UInput :model-value="mcpToken" :type="showMcpToken ? 'text' : 'password'" class="cd-w-input" readonly>
				<template #trailing>
					<UButton
						:icon="showMcpToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
						:aria-label="showMcpToken ? t.common.hide : t.common.show"
						size="xs"
						color="neutral"
						variant="link"
						@click="showMcpToken = !showMcpToken"
					/>
				</template>
			</UInput>
			<UButton :label="t.settings.copy" icon="i-lucide-copy" size="sm" color="neutral" variant="outline" @click="copy(mcpToken, t.settings.mcp.token)" />
			<UButton :label="t.settings.mcp.regenerate" size="sm" color="neutral" variant="ghost" @click="regenerateToken" />
		</SettingRow>
		<SettingRow :label="t.settings.mcp.desktop" :description="desktopText">
			<UBadge v-if="desktop?.state === 'registered'" :label="t.settings.mcp.registered" color="success" variant="subtle" icon="i-lucide-check" />
			<UButton v-if="desktop?.state === 'unregistered'" :label="t.settings.mcp.register" icon="i-lucide-plug" size="sm" @click="registerDesktop" />
			<UButton v-if="desktop?.state === 'outdated'" :label="t.settings.mcp.reregister" icon="i-lucide-refresh-cw" size="sm" @click="registerDesktop" />
			<UButton
				v-if="desktop?.state === 'registered' || desktop?.state === 'outdated'"
				:label="t.settings.mcp.unregister"
				size="sm"
				color="neutral"
				variant="ghost"
				@click="unregisterDesktop"
			/>
		</SettingRow>
		<SettingRow :label="t.settings.mcp.code" stacked :description="t.settings.mcp.codeDesc">
			<div class="cmd">
				<code>{{ claudeCommand.replace(mcpToken, showMcpToken ? mcpToken : '••••••') }}</code>
				<UButton
					icon="i-lucide-copy"
					size="xs"
					color="neutral"
					variant="outline"
					:label="t.settings.copy"
					@click="copy(claudeCommand, t.settings.mcp.command)"
				/>
			</div>
		</SettingRow>
	</template>
</template>

<style scoped>
.cmd {
	display: flex;
	gap: 8px;
	align-items: flex-start;
}

.cmd code {
	flex: 1;
	min-width: 0;
	font-size: 12px;
	padding: 6px 8px;
	border-radius: 6px;
	background: var(--ui-bg-elevated);
	overflow-wrap: anywhere;
}
</style>
