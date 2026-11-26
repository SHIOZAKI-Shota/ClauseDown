<script setup lang="ts">
import type { ConflictChoice, SyncState } from '@shared/api'
import { useApp } from '~/stores/app'
import { toPlain } from '~/utils/ipc'
import { useT } from '~/composables/useT'

const props = defineProps<{ state: Extract<SyncState, { state: 'diverged' }> }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()
const choices = ref<Record<string, ConflictChoice>>({})
const unresolved = computed(() => props.state.conflicts.filter((c) => !choices.value[c.path]).length)
const auto = computed(() => props.state.autoMerged ?? [])
const summary = computed(() => t.value.sync.conflict.summary(props.state.conflicts.length, auto.value.length))

async function apply() {
	await app.flushEditor()
	const s = await app.run(() => window.api.resolveConflicts(app.repoDir!, props.state.theirs, toPlain(choices.value)))
	if (!s) return
	app.syncState = s
	if (s.state === 'error') app.notify(s.message, true)
	else app.notify(t.value.sync.conflict.merged)
	await app.afterBranchChange()
	emit('close')
}
</script>

<template>
	<WorkspaceModal v-if="state.conflicts.length" :title="t.sync.conflict.title" :summary="summary" @close="emit('close')">
		<ConflictResolver v-model="choices" :conflicts="state.conflicts" :ours-label="t.sync.conflict.ours" :theirs-label="t.sync.conflict.theirs" />
		<template #footer>
			<span class="cd-grow" />
			<UButton :label="t.sync.conflict.later" size="sm" color="neutral" variant="outline" @click="emit('close')" />
			<UButton :label="t.sync.conflict.apply" size="sm" :loading="app.busy" :disabled="unresolved > 0" @click="apply" />
		</template>
	</WorkspaceModal>

	<UModal v-else :open="true" :title="t.sync.conflict.title" @update:open="(v) => !v && emit('close')">
		<template #body>
			<p class="text">{{ t.sync.conflict.noOverlap }}</p>
			<ul v-if="auto.length" class="files">
				<li v-for="f in auto" :key="f">{{ f }}</li>
			</ul>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<UButton :label="t.sync.conflict.later" color="neutral" variant="outline" @click="emit('close')" />
				<UButton :label="t.sync.conflict.apply" :loading="app.busy" @click="apply" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.text {
	margin: 0 0 8px;
	font-size: 13px;
}

.files {
	margin: 0;
	padding-left: 20px;
	font-size: 13px;
	list-style: disc;
}
</style>
