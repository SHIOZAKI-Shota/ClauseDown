<script setup lang="ts">
import type { HouritsuConversion } from '@shared/houritsu'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ dir: string; paths: string[] }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()

const open = ref(true)
const busy = ref(false)
const result = ref<HouritsuConversion | null>(null)
const repoName = computed(() => app.settings?.repos.find((r) => r.dir === props.dir)?.name ?? '')

watch(open, (v) => !v && emit('close'))

async function convert() {
	busy.value = true
	const r = await app.run(() => window.api.convertHouritsu(props.dir, [...props.paths]))
	busy.value = false
	if (!r) return
	if (props.dir === app.repoDir) await app.refreshDocs()
	if (!r.warnings.length && !r.skipped.length) {
		app.notify(t.value.editor.houritsu.converted(r.converted))
		open.value = false
		return
	}
	result.value = r
}
</script>

<template>
	<UModal v-model:open="open" :title="result ? t.editor.houritsu.titleDone : t.editor.houritsu.title" :dismissible="!busy">
		<template #body>
			<div v-if="!result" class="body">
				<p>{{ t.editor.houritsu.intro(repoName, paths.length) }}</p>
				<ul class="cd-muted notes">
					<li>{{ t.editor.houritsu.keepNumbers }}</li>
					<li>{{ t.editor.houritsu.dropHeadings }}</li>
					<li>{{ t.editor.houritsu.original }}</li>
				</ul>
			</div>
			<div v-else class="body">
				<p>{{ t.editor.houritsu.convertedDone(result.converted) }}</p>
				<p v-if="result.skipped.length" class="cd-muted">
					{{ t.editor.houritsu.skipped(result.skipped.length, result.skipped.join(t.editor.houritsu.listSep)) }}
				</p>
				<template v-if="result.warnings.length">
					<p>{{ t.editor.houritsu.check }}</p>
					<ul class="warns">
						<li v-for="w in result.warnings" :key="w.path">
							<strong>{{ w.path }}</strong>
							<span v-for="m in w.messages" :key="m" class="cd-muted">{{ m }}</span>
						</li>
					</ul>
				</template>
			</div>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<template v-if="!result">
					<UButton :label="t.editor.houritsu.cancel" color="neutral" variant="outline" :disabled="busy" @click="open = false" />
					<UButton :label="t.editor.houritsu.convert" :loading="busy" @click="convert" />
				</template>
				<UButton v-else :label="t.common.close" @click="open = false" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.body {
	display: flex;
	flex-direction: column;
	gap: 10px;
	font-size: 14px;
}

.notes {
	margin: 0;
	padding-left: 1.2em;
	list-style: disc;
	font-size: 13px;
}

.warns {
	max-height: 240px;
	overflow: auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	font-size: 13px;
}

.warns li {
	display: flex;
	flex-direction: column;
}
</style>
