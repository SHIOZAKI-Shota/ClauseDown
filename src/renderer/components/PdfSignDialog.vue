<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import { usePdfSign } from '~/composables/usePdfSign'
import { useT } from '~/composables/useT'

const { prompt } = usePdfSign()
const t = useT()
const ask = useConfirm()
const m = computed(() => t.value.signing.myna)
const p = computed(() => t.value.signing.pdf)
const certId = ref('')
const pin = ref('')
const cert = computed(() => prompt.value?.certs.find((c) => c.id === certId.value))
const isMyna = computed(() => cert.value?.kind === 'myna')
const validPin = computed(() => /^[0-9A-Za-z]{6,16}$/.test(pin.value))
const retries = computed(() => prompt.value?.myna?.retries ?? null)
const items = computed(() => (prompt.value?.certs ?? []).map((c) => ({ value: c.id, label: c.label || p.value.kinds[c.kind] })))

watch(prompt, (v) => {
	pin.value = ''
	certId.value = v?.certId ?? ''
})

function cancel() {
	prompt.value?.resolve(null)
}
async function submit() {
	if (!prompt.value || !cert.value) return
	if (!isMyna.value) {
		prompt.value.resolve({ certId: certId.value })
		return
	}
	if (!validPin.value) return
	if (retries.value === 1 && !(await ask({ title: m.value.lastTry, confirmLabel: t.value.common.proceed, color: 'error' }))) return
	const value = pin.value.toUpperCase()
	pin.value = ''
	prompt.value.resolve({ certId: certId.value, pin: value })
}
</script>

<template>
	<UModal :open="!!prompt" :title="isMyna ? m.pinTitle : p.pickTitle" @update:open="(v) => !v && cancel()">
		<template #body>
			<div v-if="prompt" class="cd-form">
				<p class="target">{{ m.target(prompt.name) }}</p>
				<UFormField v-if="prompt.askCert" :label="p.pickLabel">
					<USelect v-model="certId" :items="items" class="cd-full" @keydown.enter="submit" />
				</UFormField>
				<template v-if="isMyna">
					<UAlert color="warning" variant="subtle" icon="i-lucide-id-card" :description="m.disclosure" />
					<UFormField :label="m.pinLabel" :help="retries !== null ? m.retries(retries) : m.lockNote">
						<UInput v-model="pin" type="password" autocomplete="off" autofocus class="cd-full" @keydown.enter="submit" />
					</UFormField>
					<p v-if="retries !== null" class="cd-muted note">{{ m.lockNote }}</p>
				</template>
			</div>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<UButton :label="t.common.cancel" color="neutral" variant="outline" @click="cancel" />
				<UButton :label="m.sign" :disabled="!cert || (isMyna && !validPin)" icon="i-lucide-pen-line" :autofocus="!isMyna" @click="submit" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.target {
	margin: 0;
	font-weight: 500;
}
.note {
	font-size: 12px;
	margin: 0;
}
</style>
