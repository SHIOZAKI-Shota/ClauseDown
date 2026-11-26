<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import { isHttpsUrl, MD_METHODS, validSelector, validSigner, type MdKeyEntry, type MdKeyKind, type MdMethod, type MdSigningSettings } from '@shared/mdsig'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ md: MdSigningSettings; appKey: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const app = useApp()
const t = useT()
const ask = useConfirm()
const m = computed(() => t.value.mdsig.settings)

const kindItems = computed<SegmentItem<MdKeyKind>[]>(() => [
	{ value: 'app', label: m.value.kinds.app, disabled: !props.appKey },
	{ value: 'passkey', label: m.value.kinds.passkey },
])
const methodItems = computed<SegmentItem<MdMethod>[]>(() => MD_METHODS.map((value) => ({ value, label: m.value.methods[value] })))

const adding = ref(false)
const waiting = ref(false)
const form = reactive({ kind: 'passkey' as MdKeyKind, label: '', method: 'directory' as MdMethod, signer: '', selector: '', page: '' })
watch(
	() => props.appKey,
	(has) => (form.kind = has ? 'app' : 'passkey'),
	{ immediate: true },
)
watch(
	() => props.md.pages,
	(pages) => {
		if (!pages.includes(form.page)) form.page = pages[0] ?? ''
	},
	{ immediate: true },
)
const formOk = computed(
	() =>
		validSigner(form.method, form.signer.trim()) &&
		(!form.selector || (form.method === 'dns' && validSelector(form.selector))) &&
		(form.kind === 'app' ? props.appKey : !!form.page),
)

async function add() {
	waiting.value = true
	const added = await app.run(() =>
		window.api.addMdKey({
			kind: form.kind,
			label: form.label.trim(),
			method: form.method,
			signer: form.signer.trim(),
			...(form.method === 'dns' && form.selector ? { selector: form.selector } : {}),
			...(form.kind === 'passkey' ? { page: form.page } : {}),
		}),
	)
	waiting.value = false
	if (!added) return
	adding.value = false
	form.label = ''
	form.signer = ''
	form.selector = ''
	emit('changed')
}

async function remove(k: MdKeyEntry) {
	if (!(await ask({ title: m.value.confirmRemove, confirmLabel: t.value.common.delete, color: 'error' }))) return
	await app.run(() => window.api.removeMdKey(k.id))
	emit('changed')
}

async function set(patch: Parameters<typeof window.api.setMdSigning>[0]) {
	await app.run(() => window.api.setMdSigning(patch))
	emit('changed')
}

const keyType = (k: MdKeyEntry) => (k.kind === 'passkey' ? 'es256' : 'ed25519')
const keyValue = (k: MdKeyEntry) => k.publicKey?.slice(k.publicKey.indexOf(':') + 1) ?? ''
const dnsName = (k: MdKeyEntry) => `${k.selector ? `${k.selector}.` : ''}_mdsig.${k.signer}`
const dnsRecord = (k: MdKeyEntry) => `${dnsName(k)}. IN TXT "v=mdsig1; k=${keyType(k)}; p=${keyValue(k)}"`
async function copy(text: string) {
	await app.copy(text, m.value.copied)
}

const newPage = ref('')
async function addPage() {
	const url = newPage.value.trim()
	if (!isHttpsUrl(url)) return app.notify(m.value.badPage, true)
	if (props.md.pages.includes(url)) return (newPage.value = '')
	await set({ pages: [...props.md.pages, url] })
	newPage.value = ''
}
const removePage = (url: string) => set({ pages: props.md.pages.filter((p) => p !== url) })

const repoKeyItems = computed(() => [
	{ value: '', label: m.value.repoKeyDefault },
	...props.md.keys.map((k) => ({ value: k.id, label: k.label || `${k.method}:${k.signer}` })),
])
const repoKey = computed(() => (app.repoDir ? (props.md.repoKeys[app.repoDir] ?? '') : ''))
</script>

<template>
	<p class="cd-muted note">{{ m.desc }}</p>
	<div v-for="k in md.keys" :key="k.id" class="key">
		<div class="key-head">
			<span class="key-name">{{ k.label || `${k.method}:${k.signer}` }}</span>
			<span class="cd-chip">{{ m.kinds[k.kind] }}</span>
			<UBadge v-if="md.defaultKey === k.id" :label="m.default" color="primary" variant="subtle" size="sm" />
			<span class="cd-grow" />
			<UButton v-if="md.defaultKey !== k.id" :label="m.makeDefault" size="xs" color="neutral" variant="ghost" @click="set({ defaultKey: k.id })" />
			<UButton :label="m.remove" size="xs" color="error" variant="ghost" @click="remove(k)" />
		</div>
		<dl>
			<dt>method</dt>
			<dd>{{ k.method }}</dd>
			<dt>signer</dt>
			<dd>{{ k.signer }}</dd>
			<template v-if="k.selector">
				<dt>selector</dt>
				<dd>{{ k.selector }}</dd>
			</template>
			<template v-if="k.rpId">
				<dt>rp_id</dt>
				<dd>{{ k.rpId }}</dd>
			</template>
			<dt>{{ m.publicKey }}</dt>
			<dd class="mono">{{ k.publicKey }}</dd>
		</dl>
		<div v-if="k.method === 'dns'" class="record">
			<span class="cd-muted">{{ m.dnsRecord }}</span>
			<code>{{ dnsRecord(k) }}</code>
			<UButton :label="m.copy" size="xs" color="neutral" variant="outline" icon="i-lucide-copy" @click="copy(dnsRecord(k))" />
		</div>
		<div v-else-if="k.method === 'directory'" class="record">
			<span class="cd-muted">{{ m.directoryNote }}</span>
			<UButton :label="m.copy" size="xs" color="neutral" variant="outline" icon="i-lucide-copy" @click="copy(keyValue(k))" />
		</div>
	</div>
	<p v-if="!md.keys.length" class="cd-muted note">{{ m.noKeys }}</p>
	<UButton v-if="!adding" :label="m.add" size="sm" color="neutral" variant="outline" icon="i-lucide-plus" class="self-start" @click="adding = true" />

	<div v-if="adding" class="key add">
		<RenderScope>
			<UFormField :label="m.kind" :help="form.kind === 'passkey' ? m.passkeyNote : !appKey ? m.noAppKey : undefined">
				<SegmentSwitch v-model="form.kind" :items="kindItems" size="sm" />
			</UFormField>
			<UFormField :label="m.label" :help="m.labelHint"><UInput v-model="form.label" class="cd-w-input" /></UFormField>
			<UFormField :label="m.method" :help="m.methodDesc[form.method]">
				<SegmentSwitch v-model="form.method" :items="methodItems" size="sm" />
			</UFormField>
			<UFormField :label="m.signer"><UInput v-model="form.signer" :placeholder="m.signerHint[form.method]" class="cd-w-input" /></UFormField>
			<UFormField v-if="form.method === 'dns'" :label="m.selector" :help="m.selectorHint"
				><UInput v-model="form.selector" class="cd-w-small"
			/></UFormField>
			<UFormField v-if="form.kind === 'passkey'" :label="m.page">
				<USelect v-model="form.page" :items="md.pages" class="cd-w-input" />
			</UFormField>
			<div class="actions">
				<span v-if="waiting" class="cd-muted">{{ m.adding }}</span>
				<UButton :label="t.common.cancel" size="sm" color="neutral" variant="outline" :disabled="waiting" @click="adding = false" />
				<UButton :label="m.add" size="sm" :disabled="!formOk || waiting" :loading="waiting" @click="add" />
			</div>
		</RenderScope>
	</div>

	<SettingRow v-if="app.repoDir && md.keys.length" :label="m.repoKey">
		<USelect
			:model-value="repoKey"
			:items="repoKeyItems"
			class="cd-w-input"
			@update:model-value="(v: string) => set({ repo: { dir: app.repoDir!, key: v || undefined } })"
		/>
	</SettingRow>
	<SettingRow :label="m.role" :description="m.roleDesc">
		<UInput :model-value="md.role" class="cd-w-small" @change="(e: Event) => set({ role: (e.target as HTMLInputElement).value.trim() })" />
	</SettingRow>
	<SettingRow :label="m.reason" :description="m.reasonDesc">
		<UInput :model-value="md.reason" class="cd-w-input" @change="(e: Event) => set({ reason: (e.target as HTMLInputElement).value })" />
	</SettingRow>
	<SettingRow :label="m.tsa" :description="m.tsaDesc">
		<USwitch :model-value="md.tsa" @update:model-value="(v: boolean) => set({ tsa: v })" />
	</SettingRow>
	<SettingRow :label="m.pages" :description="m.pagesDesc">
		<div class="pages">
			<div v-for="p in md.pages" :key="p" class="page">
				<code>{{ p }}</code>
				<UButton
					icon="i-lucide-x"
					size="xs"
					color="neutral"
					variant="ghost"
					:disabled="md.pages.length <= 1"
					:aria-label="m.remove"
					@click="removePage(p)"
				/>
			</div>
			<div class="page">
				<UInput v-model="newPage" placeholder="https://" size="sm" class="cd-w-input" @keydown.enter="addPage" />
				<UButton :label="m.addPage" size="xs" color="neutral" variant="outline" @click="addPage" />
			</div>
		</div>
	</SettingRow>
</template>

<style scoped>
.cd-subhead {
	margin: 20px 0 4px;
	font-size: 13px;
	font-weight: 600;
	color: var(--ui-text-muted);
}
.note {
	font-size: 12px;
	margin: 4px 0 8px;
}
.key {
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	padding: 12px 14px;
	margin: 8px 0;
}
.key.add {
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.key-head {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}
.key-name {
	font-weight: 600;
}
dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 16px;
	margin: 0;
	font-size: 13px;
}
dt {
	color: var(--ui-text-muted);
}
dd {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}
.mono,
code {
	font-family: var(--cd-mono, ui-monospace, monospace);
	font-size: 12px;
}
.record {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: 10px;
	font-size: 12px;
}
.record code {
	flex: 1 1 100%;
	padding: 6px 8px;
	border-radius: 4px;
	background: var(--ui-bg-elevated);
	overflow-wrap: anywhere;
}
.actions {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 8px;
}
.pages {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.page {
	display: flex;
	align-items: center;
	gap: 6px;
}
</style>
