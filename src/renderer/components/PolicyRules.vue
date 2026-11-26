<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import type { PolicyStatus, PolicyWarning } from '@shared/api'
import type { PolicyDraft, PolicyPerson } from '@shared/policy'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import { sameJson, toPlain } from '~/utils/ipc'

const emit = defineEmits<{ status: [PolicyStatus | null] }>()
const app = useApp()
const t = useT()
const ask = useConfirm()
const p = computed(() => t.value.signing.policy)

const status = ref<PolicyStatus | null>(null)
const draft = ref<PolicyDraft | null>(null)
const busy = ref(false)

async function load() {
	if (!app.repoDir) return
	status.value = (await window.api.policyStatus(app.repoDir).catch(() => null)) ?? null
	draft.value = status.value ? structuredClone(toPlain(status.value.draft)) : null
	emit('status', status.value)
}
onMounted(load)
watch(() => app.repoDir, load)

const dirty = computed(() => !!status.value?.signed && !!draft.value && !sameJson(toPlain(draft.value), toPlain(status.value.draft)))

async function apply(fn: () => Promise<PolicyStatus>, done?: string) {
	busy.value = true
	try {
		const next = await app.run(fn, done)
		if (next) {
			status.value = next
			draft.value = structuredClone(toPlain(next.draft))
			emit('status', next)
			await app.refreshDocs()
		}
	} finally {
		busy.value = false
	}
}
const signRules = () => apply(() => window.api.signLegacyRules(app.repoDir!))
const propose = () => apply(() => window.api.proposePolicy(app.repoDir!, toPlain(draft.value!)), p.value.proposed)
const cosign = (file: string) => apply(() => window.api.cosignPolicy(app.repoDir!, file), p.value.cosigned)
async function acceptGenesis() {
	if (await ask({ title: p.value.acceptGenesis, description: p.value.acceptGenesisConfirm, confirmLabel: p.value.acceptGenesis }))
		void apply(() => window.api.acceptGenesisChange(app.repoDir!))
}
function reset() {
	if (status.value) draft.value = structuredClone(toPlain(status.value.draft))
}

function warningText(w: PolicyWarning) {
	const m = p.value.warnings
	switch (w.kind) {
		case 'invalid':
			return m.invalid
		case 'unapproved':
			return m.unapproved(w.version)
		case 'forked':
			return m.forked(w.version)
		case 'genesisChanged':
			return m.genesisChanged
		case 'rollback':
			return m.rollback(w.version)
		default:
			return m.removed
	}
}
const severe = computed(() => status.value?.warnings.some((w) => w.kind === 'genesisChanged' || w.kind === 'rollback' || w.kind === 'removed'))

const now = () => new Date(Date.now() - 60_000).toISOString()
const fp = (key: string) => {
	const b64 = key.split(' ')[1] ?? ''
	return `${key.split(' ')[0]} …${b64.slice(-12)}`
}
function addPerson(list: PolicyPerson[]) {
	list.push({ name: '', keys: [] })
}
function addMyKey(person: PolicyPerson) {
	const mine = status.value?.me.publicKey
	if (mine && !person.keys.some((k) => k.publicKey === mine)) person.keys.push({ publicKey: mine, validFrom: now() })
}
function pasteKey(person: PolicyPerson) {
	const v = prompt(p.value.pasteKey)?.trim()
	if (!v) return
	const key = v.split(/\s+/).slice(0, 2).join(' ')
	if (/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+$/.test(key) && !person.keys.some((k) => k.publicKey === key))
		person.keys.push({ publicKey: key, validFrom: now() })
}
async function fromForge(person: PolicyPerson) {
	if (!person.login || !app.repoDir) return
	const keys = (await app.run(() => window.api.forgePublicKeys(app.repoDir!, person.login!))) ?? []
	if (!keys.length) {
		app.notify(p.value.noForgeKeys, true)
		return
	}
	for (const k of keys) {
		const key = k.split(/\s+/).slice(0, 2).join(' ')
		if (!person.keys.some((x) => x.publicKey === key)) person.keys.push({ publicKey: key, validFrom: now() })
	}
}
const rotatable = computed(() => {
	const me = status.value?.me
	if (!me?.publicKey || !draft.value) return false
	return [...draft.value.approvers, ...draft.value.admins].some((x) => x.keys.some((k) => !k.validUntil && me.previousKeys.includes(k.publicKey)))
})
function rotate() {
	const me = status.value?.me
	if (!me?.publicKey || !draft.value) return
	const at = new Date().toISOString()
	for (const x of [...draft.value.approvers, ...draft.value.admins]) {
		const old = x.keys.filter((k) => !k.validUntil && me.previousKeys.includes(k.publicKey))
		if (!old.length) continue
		for (const k of old) k.validUntil = at
		if (!x.keys.some((k) => k.publicKey === me.publicKey)) x.keys.push({ publicKey: me.publicKey, validFrom: now() })
	}
}
const mine = (person: PolicyPerson) => !!status.value?.me.publicKey && person.keys.some((k) => k.publicKey === status.value!.me.publicKey && !k.validUntil)
const summary = (d: PolicyDraft) => p.value.summary(d.approvers.map((a) => a.name).join('、') || '—', d.approvalThreshold)
const openPending = ref<string | null>(null)
</script>

<template>
	<div v-if="status" class="policy">
		<template v-if="!status.signed">
			<UAlert color="warning" variant="subtle" icon="i-lucide-shield-alert" :title="p.unsigned" :description="p.unsignedDesc">
				<template #actions>
					<UButton :label="p.sign" size="sm" :loading="busy" :disabled="!status.me.publicKey" @click="signRules" />
				</template>
			</UAlert>
			<p v-if="!status.me.publicKey" class="cd-muted note">{{ p.needKey }}</p>
		</template>

		<template v-else-if="draft">
			<div class="head">
				<UBadge :label="p.signed(status.version)" color="success" variant="subtle" icon="i-lucide-shield-check" />
				<span class="cd-muted fp" :title="p.genesisNote">{{ p.genesis(status.genesis) }}</span>
			</div>

			<UAlert
				v-for="(w, i) in status.warnings"
				:key="i"
				:color="severe ? 'error' : 'warning'"
				variant="subtle"
				icon="i-lucide-triangle-alert"
				:description="warningText(w)"
			>
				<template v-if="w.kind === 'genesisChanged' || w.kind === 'removed'" #actions>
					<UButton :label="p.acceptGenesis" size="xs" color="neutral" variant="outline" @click="acceptGenesis" />
				</template>
			</UAlert>

			<UAlert v-if="rotatable" color="info" variant="subtle" icon="i-lucide-key-round" :description="p.rotateDesc">
				<template #actions>
					<UButton :label="p.rotate" size="xs" color="neutral" variant="outline" @click="rotate" />
				</template>
			</UAlert>

			<SettingRow :label="t.repo.settings.requireApproval" :description="t.repo.settings.requireApprovalDesc">
				<USwitch v-model="draft.requireApproval" />
			</SettingRow>
			<SettingRow :label="p.threshold">
				<UInput v-model.number="draft.approvalThreshold" type="number" min="1" :max="Math.max(1, draft.approvers.length)" class="cd-w-small" />
			</SettingRow>
			<SettingRow :label="t.signing.repo.requireSigned" :description="t.signing.repo.requireSignedDesc">
				<USwitch v-model="draft.requireSignedApproval" :disabled="!draft.requireApproval" />
			</SettingRow>

			<template v-for="kind in ['approvers', 'admins'] as const" :key="kind">
				<SettingRow :label="p[kind]" :description="kind === 'admins' ? p.adminsDesc : undefined" stacked>
					<div class="people">
						<div v-for="(person, i) in draft[kind]" :key="i" class="person">
							<UInput v-model="person.name" :placeholder="p.name" size="sm" class="name" />
							<UInput v-model="person.login" :placeholder="p.login" size="sm" class="login" />
							<div class="keys">
								<span v-for="(k, j) in person.keys" :key="k.publicKey" class="key" :class="{ ended: k.validUntil }">
									<UIcon name="i-lucide-key-round" />
									<code>{{ fp(k.publicKey) }}</code>
									<UButton
										icon="i-lucide-x"
										size="xs"
										color="neutral"
										variant="ghost"
										:aria-label="p.removeKey"
										@click="person.keys.splice(j, 1)"
									/>
								</span>
								<span v-if="!person.keys.length" class="cd-muted">{{ p.noKey }}</span>
							</div>
							<UDropdownMenu
								:items="[
									{
										label: p.addMyKey,
										icon: 'i-lucide-user-check',
										disabled: !status.me.publicKey || mine(person),
										onSelect: () => addMyKey(person),
									},
									{ label: p.pasteKey, icon: 'i-lucide-clipboard', onSelect: () => pasteKey(person) },
									{
										label: p.fromForge,
										icon: 'i-lucide-cloud-download',
										disabled: !person.login || !app.forge,
										onSelect: () => fromForge(person),
									},
								]"
							>
								<UButton
									icon="i-lucide-key-round"
									size="xs"
									color="neutral"
									variant="outline"
									trailing-icon="i-lucide-chevron-down"
									:aria-label="p.addKey"
								/>
							</UDropdownMenu>
							<UButton
								icon="i-lucide-trash-2"
								size="xs"
								color="neutral"
								variant="ghost"
								:aria-label="p.remove"
								@click="draft[kind].splice(i, 1)"
							/>
						</div>
						<UButton
							:label="p.addPerson"
							size="xs"
							color="neutral"
							variant="outline"
							icon="i-lucide-plus"
							class="self-start"
							@click="addPerson(draft[kind])"
						/>
					</div>
				</SettingRow>
			</template>
			<SettingRow :label="p.adminThreshold">
				<UInput v-model.number="draft.adminThreshold" type="number" min="1" :max="Math.max(1, draft.admins.length)" class="cd-w-small" />
			</SettingRow>

			<div class="actions">
				<UButton :label="p.reset" size="sm" color="neutral" variant="ghost" :disabled="!dirty" @click="reset" />
				<UButton
					:label="p.propose"
					size="sm"
					:loading="busy"
					:disabled="!dirty || !status.me.publicKey || severe"
					icon="i-lucide-send"
					@click="propose"
				/>
			</div>

			<template v-if="status.pending.length">
				<h4 class="sub">{{ p.pending }}</h4>
				<div v-for="x in status.pending" :key="x.file" class="pending">
					<div class="row">
						<span>{{ p.pendingRow(x.version, x.createdBy, x.have, x.needed) }}</span>
						<UButton :label="p.show" size="xs" color="neutral" variant="ghost" @click="openPending = openPending === x.file ? null : x.file" />
						<UBadge v-if="x.signedByMe" :label="p.signedByYou" color="neutral" variant="subtle" />
						<UButton v-else :label="p.cosign" size="xs" :disabled="!status.me.isAdmin" @click="cosign(x.file)" />
					</div>
					<p v-if="openPending === x.file" class="cd-muted note">{{ summary(x.draft) }}</p>
				</div>
			</template>
			<p v-if="app.forge" class="cd-muted note">{{ p.forgeNote(app.forgeLabel) }}</p>
		</template>
	</div>
</template>

<style scoped>
.policy {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 8px;
}
.head {
	display: flex;
	align-items: center;
	gap: 12px;
}
.fp {
	font-size: 12px;
	font-family: var(--cd-mono, monospace);
}
.note {
	font-size: 12px;
	margin: 0;
}
.people {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
}
.person {
	display: grid;
	grid-template-columns: 140px 140px 1fr auto auto;
	align-items: center;
	gap: 6px;
}
.keys {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	font-size: 12px;
}
.key {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 0 2px 0 6px;
	border: 1px solid var(--ui-border);
	border-radius: 4px;
}
.key.ended {
	opacity: 0.55;
}
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
.sub {
	margin: 12px 0 0;
	font-size: 13px;
}
.pending .row {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
}
</style>
