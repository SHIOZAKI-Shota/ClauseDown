<script setup lang="ts">
import { groupRepos } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { repoSectionItems } from '~/composables/useRepoSectionMenu'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const open = ref(false)
const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'
watch(open, (v) => v && app.checkRepos())

const groups = computed(() => [
	...groupRepos(app.settings?.repos ?? []).map((g) => ({
		id: `repos:${g.section}`,
		...(g.section ? { label: g.section } : {}),
		items: g.repos.map((r) => ({
			label: r.name,
			suffix: missing(r.dir) ? t.value.repo.notFound : r.url || r.dir,
			icon: missing(r.dir) ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive',
			active: r.dir === app.repoDir,
			onSelect: () => {
				open.value = false
				app.switchRepo(r.dir)
			},
		})),
	})),
	{
		id: 'manage',
		items: [
			...(app.repoDir
				? [
						{
							label: t.value.repo.switcher.home,
							icon: 'i-lucide-layout-grid',
							onSelect: () => {
								open.value = false
								app.goRepoHome()
							},
						},
						{
							label: t.value.repo.switcher.repoSettings,
							icon: 'i-lucide-settings-2',
							onSelect: () => {
								open.value = false
								app.view = 'repo'
							},
						},
					]
				: []),
			{
				label: t.value.repo.addManage,
				icon: 'i-lucide-plus',
				onSelect: () => {
					open.value = false
					app.openSettings('setup', 'repos')
				},
			},
		],
	},
])
const moveOpen = ref(false)
const moveItems = computed(() =>
	app.repoDir
		? repoSectionItems(app.repoDir).map((g) =>
				g.map((it) => ({
					...it,
					onSelect: (e: Event) => {
						open.value = false
						it.onSelect?.(e)
					},
				})),
			)
		: [],
)
const title = computed(() => t.value.repo.switcher.title(app.repo?.name, app.repo?.dir ?? ''))
</script>

<template>
	<UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
		<button class="cd-crumb-btn repo" data-guide="repos" :class="{ open }" :title="title" :aria-label="t.repo.switcher.aria">
			<UIcon name="i-lucide-archive" class="ci" />
			<span class="nm">{{ app.repo?.name ?? t.repo.switcher.choose }}</span>
			<UIcon name="i-lucide-chevron-down" class="caret" />
		</button>
		<template #content>
			<UCommandPalette :groups="groups" :placeholder="t.repo.switcher.search" class="palette" @mouseenter="moveOpen = false" />
			<UDropdownMenu
				v-if="app.repoDir"
				v-model:open="moveOpen"
				:modal="false"
				:items="moveItems"
				:content="{ side: 'right', align: 'end', sideOffset: 4 }"
				size="sm"
			>
				<button class="move" :class="{ on: moveOpen }" @mouseenter="moveOpen = true" @click="moveOpen = true" @keydown.esc="open = false">
					<UIcon name="i-lucide-folder-input" class="mi" />
					<span class="ml">{{ t.repo.moveSection }}</span>
					<UIcon name="i-lucide-chevron-right" class="mi" />
				</button>
			</UDropdownMenu>
		</template>
	</UPopover>
</template>

<style scoped>
.palette {
	width: 360px;
	max-height: 60vh;
}

.move {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 8px 12px;
	border-top: 1px solid var(--ui-border);
	font-size: 14px;
	text-align: left;
	color: var(--ui-text);
	cursor: pointer;
}

.move:hover,
.move.on {
	background: var(--ui-bg-elevated);
}

.ml {
	flex: 1;
}

.mi {
	width: 18px;
	height: 18px;
	color: var(--ui-text-dimmed);
}
</style>
