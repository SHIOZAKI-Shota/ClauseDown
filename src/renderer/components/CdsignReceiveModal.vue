<script setup lang="ts">
import type { ReceivedCdsign } from '@shared/mdsig'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ file: ReceivedCdsign; deliveryId: string }>()
const emit = defineEmits<{ close: []; done: [string] }>()
const app = useApp()
const t = useT()
const c = computed(() => t.value.mdsig.receive)
const busy = ref(false)
const agreement = computed(() => props.file.report.result.agreement.status)

async function save() {
	if (!app.repoDir) return
	busy.value = true
	try {
		const out = await app.run(() => window.api.saveCdsign({ path: props.file.path, dir: app.repoDir!, deliveryId: props.deliveryId }))
		if (!out) return
		app.notifyExported(c.value.done(out), out)
		emit('done', out)
		emit('close')
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<UModal :open="true" :title="c.title" :ui="{ content: 'max-w-2xl' }" @update:open="(v) => !v && emit('close')">
		<template #body>
			<div class="cd-form">
				<p class="file">{{ c.file(file.name) }}</p>
				<ul class="checks">
					<li :class="file.check.oid ? 'ok' : 'bad'">
						<UIcon :name="file.check.oid ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" />{{
							file.check.oid ? c.version(file.check.oid.slice(0, 12)) : c.noOid
						}}
					</li>
					<li :class="file.check.bodyMatches ? 'ok' : 'bad'">
						<UIcon :name="file.check.bodyMatches ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" />{{
							file.check.bodyMatches ? c.bodyOk : c.bodyBad
						}}
					</li>
					<li :class="file.check.ownKey ? 'ok' : 'warn'">
						<UIcon :name="file.check.ownKey ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" />{{ file.check.ownKey ? c.ownOk : c.ownBad }}
					</li>
					<li v-if="file.check.oid && !file.check.deliveryOid" class="warn"><UIcon name="i-lucide-triangle-alert" />{{ c.otherDelivery }}</li>
					<li v-if="agreement === 'pending'" class="warn"><UIcon name="i-lucide-triangle-alert" />{{ c.pendingNote }}</li>
				</ul>
				<div class="pane">
					<SignaturePane :report="file.report" :busy="false" embedded />
				</div>
			</div>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
				<UButton :label="c.save" icon="i-lucide-file-check" :loading="busy" :disabled="!file.check.bodyMatches" @click="save" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.file {
	margin: 0;
	font-weight: 500;
	word-break: break-all;
}
.checks {
	margin: 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 13px;
}
.checks li {
	display: flex;
	align-items: baseline;
	gap: 6px;
}
.checks .ok :deep(.iconify),
.checks li.ok > span:first-child {
	color: var(--ui-success);
}
.checks li.bad {
	color: var(--ui-error);
}
.checks li.warn {
	color: var(--ui-warning);
}
.pane {
	display: flex;
	flex-direction: column;
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	overflow: hidden;
}
</style>
