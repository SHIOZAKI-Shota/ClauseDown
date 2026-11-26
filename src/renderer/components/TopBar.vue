<script setup lang="ts">
import { useApp, type View } from '~/stores/app'
import { firstLine, fmtDate } from '~/utils/format'

const app = useApp()
const t = useT()

const tabs = computed(() => [
	{ label: t.value.shell.topBar.edit, value: 'editor', icon: 'i-lucide-square-pen' },
	{ label: t.value.shell.topBar.history, value: 'history', icon: 'i-lucide-git-commit-vertical' },
	{ label: t.value.shell.topBar.compare, value: 'compare', icon: 'i-lucide-columns-2' },
	{ label: t.value.shell.topBar.releases, value: 'releases', icon: 'i-lucide-calendar-check' },
])
const docView = computed(() => app.currentDoc && tabs.value.some((tab) => tab.value === app.view))
const tab = computed({
	get: () => app.view,
	set: (v) => {
		if (v === 'compare') app.compareTarget = null
		app.view = v as View
	},
})

const lastSaved = ref<{ oid: string; message: string; author: string; timestamp: number } | null | undefined>(undefined)
let asked = 0
watch(
	() => [app.repoDir, app.currentPath, app.currentBranch?.oid, app.reloadKey] as const,
	async ([dir, path]) => {
		lastSaved.value = undefined
		if (!dir || !path) return
		const n = ++asked
		const r = await window.api.lastChange(dir, path).catch(() => undefined)
		if (n === asked) lastSaved.value = r
	},
	{ immediate: true },
)
const savedAt = computed(() => (lastSaved.value ? fmtDate(lastSaved.value.timestamp, 'mdhm') : ''))
const versionTitle = computed(() =>
	lastSaved.value ? t.value.shell.topBar.versionTitle(app.currentBranch?.label ?? '', savedMessage.value, lastSaved.value.author, savedAt.value) : '',
)
const savedMessage = computed(() => (lastSaved.value ? firstLine(lastSaved.value.message) : ''))
</script>

<template>
	<UDashboardNavbar v-if="docView" :toggle="false" class="cd-nav">
		<template #left>
			<UTabs v-if="docView" v-model="tab" :items="tabs" :content="false" size="sm" variant="pill">
				<!-- デモの案内（demo/guide.ts）がタブを見分けるための印 -->
				<template #trailing="{ item }"><span :data-guide="item.value" hidden /></template>
			</UTabs>
		</template>
		<template v-if="docView" #default>
			<div class="doc">
				<strong class="title">{{ app.currentDoc!.title }}</strong>
				<span class="version" :title="versionTitle">
					<span class="branch" :class="{ draft: app.onDraft }">{{ app.currentBranch?.label }}</span>
					<template v-if="lastSaved">
						<span class="msg">{{ savedMessage }}</span>
						<span class="at">{{ savedAt }}</span>
					</template>
					<span v-else-if="lastSaved === null" class="msg">{{ t.shell.topBar.notSaved }}</span>
					<span v-if="app.currentDoc!.changed" class="dirty">{{ t.shell.topBar.unsaved }}</span>
				</span>
			</div>
		</template>
		<template v-if="docView" #right>
			<UButton
				:label="t.shell.topBar.due"
				icon="i-lucide-calendar-range"
				data-guide="schedule"
				size="sm"
				color="neutral"
				variant="ghost"
				:title="app.dueCount?.due ? t.shell.topBar.dueTitle(app.dueCount.overdue, app.dueCount.due - app.dueCount.overdue) : undefined"
				@click="app.openSchedule()"
			>
				<template v-if="app.dueCount?.due" #trailing>
					<UBadge :label="String(app.dueCount.due)" color="neutral" variant="subtle" size="sm" />
					<UBadge v-if="app.dueCount.overdue" :label="t.schedule.overdueCount(app.dueCount.overdue)" color="error" variant="subtle" size="sm" />
				</template>
			</UButton>
			<UButton :label="t.common.issues" icon="i-lucide-list-todo" size="sm" color="neutral" variant="ghost" data-guide="issues" @click="app.openIssues()">
				<template v-if="app.openIssueCount" #trailing>
					<UBadge :label="String(app.openIssueCount)" color="neutral" variant="subtle" size="sm" />
				</template>
			</UButton>
			<UButton
				:label="t.common.repoHome"
				icon="i-lucide-layout-grid"
				size="sm"
				color="neutral"
				variant="ghost"
				data-guide="docs"
				@click="app.goRepoHome()"
			>
				<template v-if="app.reviewCount" #trailing>
					<UBadge :label="t.shell.topBar.toReview(app.reviewCount)" color="warning" variant="subtle" size="sm" />
				</template>
			</UButton>
		</template>
	</UDashboardNavbar>
</template>

<style scoped>
.doc {
	display: flex;
	align-items: baseline;
	justify-content: center;
	gap: 10px;
	min-width: 0;
	max-width: 100%;
}

.title {
	font-size: 14px;
	white-space: nowrap;
	line-height: 1.3;
	min-width: 0;
	flex: 0 1 auto;
	overflow: hidden;
	text-overflow: ellipsis;
}

.version {
	flex: 0 1 auto;
	min-width: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 11px;
	color: var(--ui-text-muted);
	white-space: nowrap;
	overflow: hidden;
	max-width: 100%;
}

.branch {
	font-weight: 600;
	color: var(--ui-color-primary-500);
}

.branch.draft {
	color: var(--cd-draft);
}

.version > * {
	flex-shrink: 0;
}

.version > .msg {
	flex-shrink: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.at {
	color: var(--ui-text-dimmed);
}

.dirty {
	color: var(--cd-draft);
}

@media (max-width: 1180px) {
	.doc {
		display: none;
	}
}
</style>

<style>
/* UDashboardNavbar の中の要素には scoped の印が付かないので、ここは scoped にしない */
.cd-nav {
	height: 44px !important;
	min-height: 44px;
	display: grid !important;
	grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
	column-gap: 16px;
}

.cd-nav > [data-slot='center'] {
	min-width: 0;
	justify-content: center;
	overflow: hidden;
}

.cd-nav > [data-slot='right'] {
	justify-self: end;
}
</style>
