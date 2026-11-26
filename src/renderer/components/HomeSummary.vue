<script setup lang="ts">
import { useApp } from '~/stores/app'
import { allFolders } from '~/utils/folders'

const app = useApp()
const t = useT()
const unsaved = computed(() => app.docs.filter((d) => d.changed))
const folders = computed(() => allFolders(app.docs).length)
const remote = computed(() => app.repo?.url?.replace(/^https?:\/\//, '').replace(/\.git$/, ''))
const openFolder = () => app.run(() => window.api.openPath(app.repoDir!))
function review() {
	const b = app.toReview[0]
	if (b) app.dialog = { kind: 'review', branch: b.name }
	else if (app.policyToSign.length) app.openSettings('repo', 'rules')
}
</script>

<template>
	<div class="facts">
		<span class="fact" :class="{ draft: app.onDraft }" :title="t.home.summary.workingTitle">
			<UIcon :name="app.onDraft ? 'i-lucide-git-branch' : 'i-lucide-badge-check'" />{{ app.currentBranch?.label ?? t.home.summary.current }}
		</span>
		<span class="fact url" :title="app.repo?.url ?? t.home.summary.localOnlyTitle">
			<UIcon :name="remote ? 'i-lucide-cloud' : 'i-lucide-laptop'" />{{ remote ?? t.home.summary.localOnly }}
		</span>
		<span class="fact"> <UIcon name="i-lucide-file-text" />{{ t.home.summary.counts(app.docs.length, folders) }} </span>
		<UPopover v-if="unsaved.length" :content="{ align: 'start', side: 'bottom' }">
			<button class="fact warn"><UIcon name="i-lucide-circle-dot" />{{ t.home.summary.unsaved(unsaved.length) }}</button>
			<template #content>
				<div class="pop">
					<p class="cd-muted">{{ t.home.summary.unsavedNote }}</p>
					<button v-for="d in unsaved" :key="d.path" class="item" :title="d.path" @click="app.openDoc(d.path)">
						<UIcon name="i-lucide-file-pen" />{{ d.title }}
					</button>
				</div>
			</template>
		</UPopover>
		<button v-if="app.reviewCount" class="fact primary" @click="review">
			<UIcon name="i-lucide-user-check" />{{ t.home.summary.toReview(app.reviewCount) }}
		</button>
		<UTooltip :text="t.home.summary.openFolder">
			<UButton icon="i-lucide-folder-open" size="xs" color="neutral" variant="ghost" :aria-label="t.home.summary.openFolder" @click="openFolder" />
		</UTooltip>
		<UTooltip :text="t.common.repoSettings">
			<UButton icon="i-lucide-settings-2" size="xs" color="neutral" variant="ghost" :aria-label="t.common.repoSettings" @click="app.view = 'repo'" />
		</UTooltip>
	</div>
</template>

<style scoped>
.facts {
	display: flex;
	align-items: center;
	gap: 2px 12px;
	flex-wrap: wrap;
	min-width: 0;
	font-size: 12px;
	color: var(--ui-text-muted);
}

.fact {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	white-space: nowrap;
}

.fact.url {
	max-width: 280px;
	overflow: hidden;
	text-overflow: ellipsis;
	display: inline-block;
}

.fact.url :deep(svg) {
	vertical-align: -2px;
	margin-right: 4px;
}

.fact.draft {
	color: var(--cd-draft);
	font-weight: 600;
}

button.fact {
	cursor: pointer;
	padding: 0 6px;
	border-radius: 999px;
}

.fact.warn {
	color: var(--ui-color-warning-600);
	background: color-mix(in oklab, var(--ui-color-warning-500) 12%, transparent);
}

.fact.primary {
	color: var(--ui-color-primary-600);
	background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
}

.pop {
	padding: 8px;
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-width: 320px;
	font-size: 13px;
}

.pop p {
	font-size: 12px;
	margin: 0 4px 4px;
}

.item {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 6px;
	border-radius: 6px;
	text-align: left;
	cursor: pointer;
}

.item:hover {
	background: var(--ui-bg-elevated);
}
</style>
