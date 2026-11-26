<script setup lang="ts">
import { addDays, inForceAt, KIND_COLORS, type DueEventInput, type EventKind, type Occurrence } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { usePane } from '~/composables/usePane'
import { useSchedule, type RepoOccurrence, type RepoPeriod } from '~/composables/useSchedule'
import { useStoredRef } from '~/composables/useStoredRef'
import { baseName, folderOf } from '~/utils/folders'
import { daysUntil, fmtDate, untilLabel } from '~/utils/format'
import { useT } from '~/composables/useT'
import type { TimelineBand, TimelineItem, TimelineRow } from '~/components/TimelineChart.vue'

const props = defineProps<{ all?: boolean }>()
const app = useApp()
const t = useT()
const isAll = computed(() => !!props.all)
const s = useSchedule(isAll)
const pane = usePane('schedule', { size: 340, min: 280, max: 560 })
const mode = useStoredRef<'timeline' | 'list'>('clausedown.schedule.mode', 'timeline')
const showDone = useStoredRef('clausedown.schedule.done', true)
const allDocs = useStoredRef('clausedown.schedule.allDocs', false)
const groupBy = useStoredRef<'repo' | 'doc'>('clausedown.schedule.groupBy', 'repo')
const hidden = useStoredRef<string[]>('clausedown.schedule.hidden', [])
const chart = ref<{ reveal(date: string): void } | null>(null)

const repoMap = computed(() => new Map(s.repos.value.map((r) => [r.dir, r])))
const docMaps = computed(() => new Map(s.repos.value.map((r) => [r.dir, new Map(r.docs.map((d) => [d.path, d]))])))
const docOf = (path: string, dir: string) => docMaps.value.get(s.repoOf(dir)?.dir ?? '')?.get(path)
const repoName = (dir: string) => repoMap.value.get(dir)?.name ?? baseName(dir)
const titleOf = (path: string, dir: string) => (!path ? t.value.schedule.wholeRepo : (docOf(path, dir)?.title ?? baseName(path).replace(/\.md$/i, '')))
const exists = (path: string, dir: string) => !!path && !!docOf(path, dir)
const whereOf = (o: RepoOccurrence) => (isAll.value ? `${repoName(o.dir)}${t.value.common.sep}${titleOf(o.docPath, o.dir)}` : titleOf(o.docPath, o.dir))
const kindOf = (o: RepoOccurrence): EventKind => s.kindOf.value(o.kind, o.dir)

async function openDocIn(dir: string, path: string, date?: string) {
	if (dir !== app.repoDir) await app.switchRepo(dir)
	if (!app.docs.some((d) => d.path === path)) return
	app.releasesSelect = date ?? null
	app.openDoc(path, 'releases')
}

const docFilter = computed(() => (isAll.value ? null : app.scheduleDoc))
const shown = computed(() => {
	const off = new Set(hidden.value)
	return s.items.value.filter((o) => !off.has(o.kind) && (showDone.value || !o.done) && (!docFilter.value || o.docPath === docFilter.value))
})

const rowOf = (o: RepoOccurrence) => (!isAll.value ? o.docPath : groupBy.value === 'repo' ? o.dir : `${o.dir}|${o.docPath}`)
const splitRow = (id: string) => ({ dir: id.slice(0, id.indexOf('|')), path: id.slice(id.indexOf('|') + 1) })
const rows = computed<TimelineRow[]>(() => {
	if (isAll.value) {
		if (groupBy.value === 'repo') {
			const ids = new Map<string, Set<string>>()
			for (const o of shown.value) {
				if (o.source !== 'event') continue
				let set = ids.get(o.dir)
				if (!set) ids.set(o.dir, (set = new Set()))
				set.add(o.id)
			}
			return s.repos.value.map((r) => {
				const n = ids.get(r.dir)?.size ?? 0
				return { id: r.dir, label: r.name, sub: t.value.schedule.dueCount(n), title: r.dir }
			})
		}
		const keys = new Map<string, RepoOccurrence>()
		for (const o of shown.value) keys.set(`${o.dir}|${o.docPath}`, o)
		const order = new Map(s.repos.value.map((r, i) => [r.dir, i]))
		const rank = (dir: string) => order.get(dir) ?? -1
		return [...keys.entries()]
			.sort(([, a], [, b]) => rank(a.dir) - rank(b.dir) || a.docPath.localeCompare(b.docPath, 'ja'))
			.map(([id, o]) => ({
				id,
				label: titleOf(o.docPath, o.dir),
				sub: repoName(o.dir),
				title: `${repoName(o.dir)} ／ ${o.docPath || t.value.schedule.wholeRepo}`,
			}))
	}
	const dir = app.repoDir ?? ''
	if (app.scheduleDoc) return [{ id: app.scheduleDoc, label: titleOf(app.scheduleDoc, dir), sub: folderOf(app.scheduleDoc) || undefined }]
	const used = new Set([...shown.value.map((o) => o.docPath), ...s.periods.value.map((p) => p.docPath)])
	const paths = allDocs.value ? new Set([...app.docs.map((d) => d.path), ...used]) : used
	paths.delete('')
	const list = [...paths].sort((a, b) => a.localeCompare(b, 'ja'))
	return [
		{ id: '', label: t.value.schedule.wholeRepo, sub: t.value.schedule.wholeRepoSub },
		...list.map((p) => ({ id: p, label: titleOf(p, dir), sub: exists(p, dir) ? folderOf(p) || undefined : t.value.schedule.notFound, title: p })),
	]
})
const timelineBands = computed<TimelineBand[]>(() => {
	if (isAll.value && groupBy.value === 'repo') return []
	return s.periods.value
		.filter((p) => !docFilter.value || p.docPath === docFilter.value)
		.map((p) => ({ ...p, row: isAll.value ? `${p.dir}|${p.docPath}` : p.docPath }))
})
const periodOf = (o: RepoOccurrence) => s.periods.value.find((p) => p.dir === o.dir && p.docPath === o.docPath && p.date === o.date)
const spanLabel = (p: RepoPeriod) => t.value.schedule.span(fmtDate(p.date, 'ymd'), p.until ? fmtDate(p.until, 'ymd') : '')
function onBand(b: TimelineBand) {
	const dir = b.dir ?? app.repoDir ?? ''
	const o = isAll.value ? null : s.items.value.find((x) => x.source === 'tag' && x.docPath === b.docPath && x.date === b.date)
	if (o) select(o)
	else void openDocIn(dir, b.docPath, b.date)
}

const asOf = ref('')
watch(asOf, (d) => {
	if (!d) return
	if (mode.value === 'timeline') chart.value?.reveal(d)
	if (pane.state.value.collapsed) pane.expand()
})
const inForce = computed(() => {
	const d = asOf.value
	if (!d || isAll.value) return []
	const dir = app.repoDir ?? ''
	const list = s.periods.value.filter((p) => p.dir === dir)
	const docs = new Set(list.map((p) => p.docPath))
	return rows.value.filter((r) => docs.has(r.id)).map((r) => ({ row: r, p: inForceAt(list, r.id, d) }))
})

const timelineItems = computed<TimelineItem[]>(() => shown.value.map((o) => ({ ...o, row: rowOf(o), movable: o.source === 'event' && !o.repeat })))
function onRowClick(r: TimelineRow) {
	if (!isAll.value) {
		if (r.id && exists(r.id, app.repoDir ?? '')) app.openDoc(r.id, 'releases')
	} else if (groupBy.value === 'repo') void app.openSchedule(r.id)
	else {
		const { dir, path } = splitRow(r.id)
		if (path) void openDocIn(dir, path)
		else void app.openSchedule(dir)
	}
}

const selKey = ref<string | null>(null)
const sel = computed(() => s.items.value.find((o) => o.key === selKey.value) ?? null)
const selEvent = computed(() => (sel.value?.source === 'event' ? s.eventOf(sel.value.id, sel.value.dir) : undefined))
function select(o: Occurrence, reveal = false) {
	if (isAll.value) return openSource(o as RepoOccurrence)
	selKey.value = o.key
	if (pane.state.value.collapsed) pane.expand()
	if (reveal && mode.value === 'timeline') chart.value?.reveal(o.date)
}

const today = s.today
const overdue = computed(() => shown.value.filter((o) => o.overdue))
const soon = computed(() => shown.value.filter((o) => !o.overdue && !o.done && (o.end ?? o.date) >= today && o.date <= addDays(today, 30)))
const recentDone = computed(() =>
	shown.value
		.filter((o) => o.done && o.date >= addDays(today, -60) && o.date <= addDays(today, 30))
		.slice(-5)
		.reverse(),
)

const listGroups = computed(() => {
	const from = addDays(today, -90)
	const map = new Map<string, RepoOccurrence[]>()
	for (const o of shown.value) {
		if (o.overdue || (o.end ?? o.date) < from) continue
		const m = o.date.slice(0, 7)
		const list = map.get(m)
		if (list) list.push(o)
		else map.set(m, [o])
	}
	return [...map.entries()].map(([m, list]) => ({ label: t.value.schedule.monthLabel(Number(m.slice(0, 4)), Number(m.slice(5))), key: m, list }))
})

const editing = ref<null | { event?: string; dir?: string; initial?: { date?: string; docPath?: string; kind?: string } }>(null)
const editEvent = computed(() => (editing.value?.event ? s.eventOf(editing.value.event, editing.value.dir) : undefined))
function addAt(date?: string, row?: string) {
	if (!isAll.value) {
		editing.value = { initial: { date, docPath: row ?? app.scheduleDoc ?? '' } }
		return
	}
	if (row && groupBy.value === 'doc') {
		const { dir, path } = splitRow(row)
		editing.value = { dir, initial: { date, docPath: path } }
	} else {
		const dir = row ?? (s.repos.value.some((r) => r.dir === app.repoDir) ? app.repoDir! : s.repos.value[0]?.dir)
		editing.value = { dir, initial: { date, docPath: '' } }
	}
}
async function saved(input: DueEventInput, dir: string) {
	if (await s.save(input, dir)) editing.value = null
}
const removing = ref<{ id: string; dir: string } | null>(null)
async function remove() {
	const r = removing.value!
	removing.value = null
	editing.value = null
	await s.remove(r.id, r.dir)
	selKey.value = null
}

function openSource(o: RepoOccurrence) {
	if (o.source === 'event') editing.value = { event: o.id, dir: o.dir }
	else if (exists(o.docPath, o.dir)) void openDocIn(o.dir, o.docPath, o.source === 'tag' ? o.date : undefined)
}

const kindItems = computed(() => {
	const seen = new Map<string, EventKind>()
	for (const r of s.repos.value) for (const k of r.kinds) if (!seen.has(k.id)) seen.set(k.id, k)
	seen.set('delivery', s.kindOf.value('delivery'))
	return [...seen.values()].map((k) => ({
		label: k.label,
		type: 'checkbox' as const,
		checked: !hidden.value.includes(k.id),
		onUpdateChecked: (v: boolean) => (hidden.value = v ? hidden.value.filter((x) => x !== k.id) : [...hidden.value, k.id]),
		onSelect: (e: Event) => e.preventDefault(),
	}))
})
const repeatLabel = (o: RepoOccurrence) => {
	const e = s.eventOf(o.id, o.dir)
	if (!e?.repeat) return ''
	return t.value.schedule.repeat(e.repeat.every, e.repeat.until ? fmtDate(e.repeat.until, 'ymd') : undefined)
}
async function exportIcs() {
	const r = await app.run(() => window.api.exportSchedule(isAll.value ? '' : (app.repoDir ?? ''), s.today))
	if (r) app.notifyExported(t.value.schedule.exported(r.count), r.path)
}
const moreItems = computed(() => [
	[
		{ label: t.value.schedule.exportLabel, icon: 'i-lucide-calendar-arrow-down', disabled: !s.repos.value.length, onSelect: exportIcs },
		...(isAll.value
			? []
			: [
					{ label: t.value.schedule.allRepos, icon: 'i-lucide-layers', onSelect: () => app.openScheduleAll() },
					{ label: t.value.schedule.kindsLabel, icon: 'i-lucide-settings-2', onSelect: () => app.openSettings('repo', 'kinds') },
				]),
	],
])
</script>

<template>
	<div class="schedule">
		<div class="main">
			<BackButton v-if="!isAll" :label="app.pageReturnLabel('schedule')" class="back" @click="app.leavePage('schedule')" />
			<div class="cd-toolbar head">
				<strong v-if="!isAll" class="h">{{ t.schedule.title }}</strong>
				<span v-if="docFilter" class="cd-chip only">
					{{ t.schedule.onlyDoc(titleOf(docFilter, app.repoDir ?? '')) }}
					<button class="x" :aria-label="t.schedule.clearFilter" @click="app.scheduleDoc = null">
						<UIcon name="i-lucide-x" />
					</button>
				</span>
				<UButton :label="t.schedule.add" icon="i-lucide-calendar-plus" size="sm" :disabled="!s.repos.value.length" @click="addAt()" />
				<span class="cd-grow" />
				<span v-if="!isAll" class="asof">
					<UTooltip :text="t.schedule.asOfTip">
						<UIcon name="i-lucide-history" class="asof-icon" />
					</UTooltip>
					<DateField v-model="asOf" size="sm" />
					<UButton
						v-if="asOf"
						icon="i-lucide-x"
						size="xs"
						square
						color="neutral"
						variant="ghost"
						:aria-label="t.schedule.clearDate"
						@click="asOf = ''"
					/>
				</span>
				<UDropdownMenu :items="kindItems" :content="{ align: 'end' }">
					<UButton :label="t.schedule.kinds(hidden.length)" icon="i-lucide-filter" size="sm" color="neutral" variant="outline" />
				</UDropdownMenu>
				<USwitch v-model="showDone" :label="t.schedule.showDone" size="sm" />
				<SegmentSwitch
					v-if="isAll && mode === 'timeline'"
					v-model="groupBy"
					size="sm"
					:aria-label="t.schedule.rows"
					:items="[
						{ value: 'repo', label: t.schedule.byRepo },
						{ value: 'doc', label: t.schedule.byDoc },
					]"
				/>
				<USwitch v-if="!isAll && mode === 'timeline' && !app.scheduleDoc" v-model="allDocs" :label="t.schedule.allDocs" size="sm" />
				<SegmentSwitch
					v-model="mode"
					size="sm"
					:aria-label="t.schedule.viewMode"
					:items="[
						{ value: 'timeline', icon: 'i-lucide-gantt-chart', tooltip: t.schedule.timeline },
						{ value: 'list', icon: 'i-lucide-list', tooltip: t.schedule.list },
					]"
				/>
				<UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
					<UButton icon="i-lucide-ellipsis" size="sm" square color="neutral" variant="ghost" :aria-label="t.common.more" data-guide="schedule" />
				</UDropdownMenu>
			</div>

			<TimelineChart
				v-if="mode === 'timeline'"
				ref="chart"
				class="chart"
				:rows="rows"
				:items="timelineItems"
				:bands="timelineBands"
				:as-of="isAll ? null : asOf || null"
				:kind-of="s.kindOf.value"
				:selected="selKey"
				:storage-key="isAll ? 'schedule-all' : 'schedule'"
				@select="(o) => select(o)"
				@add="({ date, row }) => addAt(date, row)"
				@move="(o, d) => s.move(o, d)"
				@row-click="onRowClick"
				@band="onBand"
				@as-of="(d) => !isAll && (asOf = d)"
			/>

			<div v-else class="list">
				<div v-if="overdue.length" class="cd-list-group">
					<SectionHead :label="t.schedule.overdue" icon="i-lucide-alarm-clock-off" :count="overdue.length" pinned class="bad" />
					<OccurrenceRow
						v-for="o in overdue"
						:key="o.key"
						:o="o"
						:kind="kindOf(o)"
						:where="whereOf(o)"
						:active="selKey === o.key"
						@click="select(o)"
						@toggle="s.toggleDone(o)"
					/>
				</div>
				<div v-for="g in listGroups" :key="g.key" class="cd-list-group">
					<SectionHead :label="g.label" :count="g.list.length" pinned />
					<OccurrenceRow
						v-for="o in g.list"
						:key="o.key"
						:o="o"
						:kind="kindOf(o)"
						:where="whereOf(o)"
						:active="selKey === o.key"
						@click="select(o)"
						@toggle="s.toggleDone(o)"
					/>
				</div>
				<div v-if="s.loaded.value && !overdue.length && !listGroups.length" class="none">
					<UIcon name="i-lucide-calendar-range" class="big" />
					<p>{{ t.schedule.empty }}</p>
					<UButton v-if="s.repos.value.length" :label="t.schedule.add" icon="i-lucide-calendar-plus" size="sm" @click="addAt()" />
				</div>
			</div>
		</div>

		<SidePane v-if="!isAll" :pane="pane" side="right" :label="sel ? t.schedule.detail : t.schedule.upcoming" icon="i-lucide-calendar-clock">
			<section v-if="sel" class="detail">
				<div class="d-head">
					<span class="d-kind" :style="{ '--k': KIND_COLORS[kindOf(sel).color] }">{{ kindOf(sel).label }}</span>
					<UBadge v-if="sel.overdue" :label="t.schedule.overdue" color="error" variant="subtle" size="sm" />
					<UBadge v-else-if="sel.done" :label="t.schedule.done" color="success" variant="subtle" size="sm" />
					<UBadge v-if="sel.source === 'tag'" :label="t.schedule.hasVersion" color="primary" variant="subtle" size="sm" />
					<span class="cd-grow" />
					<UButton icon="i-lucide-x" size="xs" square color="neutral" variant="ghost" :aria-label="t.schedule.deselect" @click="selKey = null" />
				</div>
				<h3 class="d-title">{{ sel.title }}</h3>
				<dl class="facts">
					<dt>{{ t.schedule.f.date }}</dt>
					<dd>
						{{ sel.end ? t.schedule.span(fmtDate(sel.date, 'ymd'), fmtDate(sel.end, 'ymd')) : fmtDate(sel.date, 'ymd') }}
						<span class="cd-muted">{{ t.schedule.paren(untilLabel(daysUntil(sel.date, today))) }}</span>
					</dd>
					<template v-if="sel.source === 'tag' && periodOf(sel)">
						<dt>{{ t.schedule.f.period }}</dt>
						<dd>{{ spanLabel(periodOf(sel)!) }}</dd>
					</template>
					<template v-if="sel.repeat">
						<dt>{{ t.schedule.f.repeat }}</dt>
						<dd>{{ repeatLabel(sel) }}</dd>
					</template>
					<template v-if="isAll">
						<dt>{{ t.schedule.f.repo }}</dt>
						<dd><button class="link" @click="app.openSchedule(sel.dir)">{{ repoName(sel.dir) }}</button></dd>
					</template>
					<dt>{{ t.schedule.f.target }}</dt>
					<dd>
						<button v-if="exists(sel.docPath, sel.dir)" class="link" @click="openDocIn(sel.dir, sel.docPath)">
							{{ titleOf(sel.docPath, sel.dir) }}
						</button>
						<span v-else>{{ titleOf(sel.docPath, sel.dir) }}</span>
					</dd>
					<template v-if="sel.source === 'event'">
						<dt>{{ t.schedule.f.notify }}</dt>
						<dd>{{ t.schedule.remind(sel.remind) }}</dd>
					</template>
					<template v-if="sel.note">
						<dt>{{ t.schedule.f.memo }}</dt>
						<dd class="note">{{ sel.note }}</dd>
					</template>
					<template v-if="selEvent">
						<dt>{{ t.schedule.f.record }}</dt>
						<dd class="cd-muted">{{ selEvent.by }}{{ t.common.sep }}{{ fmtDate(selEvent.updatedAt, 'ymdhm') }}</dd>
					</template>
				</dl>
				<div class="d-actions">
					<UButton
						v-if="sel.task && sel.source === 'event'"
						:label="sel.done ? t.schedule.undoDone : t.schedule.markDone"
						:icon="sel.done ? 'i-lucide-undo-2' : 'i-lucide-check'"
						size="sm"
						:color="sel.done ? 'neutral' : 'primary'"
						:variant="sel.done ? 'outline' : 'solid'"
						@click="s.toggleDone(sel)"
					/>
					<UButton
						v-if="sel.source === 'event'"
						:label="t.schedule.edit"
						icon="i-lucide-pencil"
						size="sm"
						color="neutral"
						variant="outline"
						@click="openSource(sel)"
					/>
					<UButton
						v-else-if="exists(sel.docPath, sel.dir)"
						:label="t.schedule.openReleases"
						icon="i-lucide-package-check"
						data-guide="releases"
						size="sm"
						color="neutral"
						variant="outline"
						@click="openSource(sel)"
					/>
					<UButton
						v-if="sel.source === 'event'"
						:label="t.schedule.remove"
						icon="i-lucide-trash-2"
						size="sm"
						color="error"
						variant="ghost"
						@click="removing = { id: sel.id, dir: sel.dir }"
					/>
				</div>
				<p v-if="sel.source !== 'event'" class="cd-muted hint">
					{{ sel.source === 'tag' ? t.schedule.tagHint : t.schedule.deliveryHint }}
				</p>
			</section>

			<div v-if="asOf && inForce.length" class="cd-list-group">
				<SectionHead :label="t.schedule.versionsAt(fmtDate(asOf, 'ymd'))" icon="i-lucide-history" :count="inForce.length" pinned />
				<ListRow
					v-for="v in inForce"
					:key="v.row.id"
					icon="i-lucide-file-text"
					:class="{ off: !v.p }"
					@click="v.p && openDocIn(app.repoDir ?? '', v.row.id, v.p.date)"
				>
					{{ v.row.label }}
					<template #sub>{{ v.p ? spanLabel(v.p) : t.schedule.beforeEffective }}</template>
				</ListRow>
			</div>
			<div class="cd-list-group">
				<SectionHead :label="t.schedule.overdue" icon="i-lucide-alarm-clock-off" :count="overdue.length" pinned />
				<p v-if="!overdue.length" class="cd-muted empty">{{ t.schedule.none }}</p>
				<OccurrenceRow
					v-for="o in overdue"
					:key="o.key"
					:o="o"
					:kind="kindOf(o)"
					:where="whereOf(o)"
					:active="selKey === o.key"
					@click="select(o, true)"
					@toggle="s.toggleDone(o)"
				/>
			</div>
			<div class="cd-list-group">
				<SectionHead :label="t.schedule.next30" icon="i-lucide-calendar-clock" :count="soon.length" pinned />
				<p v-if="!soon.length" class="cd-muted empty">{{ t.schedule.none }}</p>
				<OccurrenceRow
					v-for="o in soon"
					:key="o.key"
					:o="o"
					:kind="kindOf(o)"
					:where="whereOf(o)"
					:active="selKey === o.key"
					@click="select(o, true)"
					@toggle="s.toggleDone(o)"
				/>
			</div>
			<div v-if="recentDone.length" class="cd-list-group">
				<SectionHead :label="t.schedule.recentDone" icon="i-lucide-circle-check" :count="recentDone.length" pinned />
				<OccurrenceRow
					v-for="o in recentDone"
					:key="o.key"
					:o="o"
					:kind="kindOf(o)"
					:where="whereOf(o)"
					:active="selKey === o.key"
					@click="select(o, true)"
					@toggle="s.toggleDone(o)"
				/>
			</div>
		</SidePane>

		<DueEventModal
			v-if="editing"
			:kinds="s.kinds.value"
			:event="editEvent"
			:initial="editing.initial"
			:repo-choices="isAll ? s.repos.value : undefined"
			:dir="editing.dir"
			@close="editing = null"
			@save="saved"
			@remove="(id, dir) => (removing = { id, dir })"
		/>
		<ConfirmModal
			:open="!!removing"
			:title="t.schedule.removeTitle"
			:confirm-label="t.schedule.remove"
			color="error"
			@update:open="(v) => !v && (removing = null)"
			@confirm="remove"
		>
			<p>{{ t.schedule.removeBody }}</p>
		</ConfirmModal>
	</div>
</template>

<style scoped>
.asof {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.asof-icon {
	width: 16px;
	height: 16px;
	color: var(--ui-text-muted);
}

.off {
	opacity: 0.55;
}

.schedule {
	display: flex;
	height: 100%;
}

.main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.back {
	align-self: flex-start;
	margin: 10px 0 -2px 14px;
}

.head {
	flex-wrap: wrap;
	row-gap: 6px;
}

.h {
	font-size: 14px;
}

.only {
	gap: 4px;
}

.x {
	display: inline-flex;
	cursor: pointer;
	color: var(--ui-text-muted);
}

.x:hover {
	color: var(--ui-text);
}

.chart {
	flex: 1;
}

.list {
	flex: 1;
	min-height: 0;
	overflow: auto;
}

.bad :deep(.label) {
	color: var(--ui-color-error-500);
}

.none {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 10px;
	padding: 64px 16px;
	color: var(--ui-text-muted);
	font-size: 13px;
}

.big {
	width: 32px;
	height: 32px;
	color: var(--ui-text-dimmed);
}

.empty {
	padding: 0 12px 4px;
	font-size: 12px;
}

.detail {
	padding: 10px 12px 12px;
	border-bottom: 1px solid var(--ui-border);
	background: var(--ui-bg-elevated);
}

.d-head {
	display: flex;
	align-items: center;
	gap: 6px;
}

.d-kind {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 12px;
	font-weight: 700;
}

.d-kind::before {
	content: '';
	width: 9px;
	height: 9px;
	border-radius: 2px;
	transform: rotate(45deg);
	background: var(--k);
}

.d-title {
	margin: 6px 0 8px;
	font-size: 15px;
	font-weight: 700;
}

.facts {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 4px 12px;
	margin: 0 0 10px;
	font-size: 13px;
}

dt {
	color: var(--ui-text-muted);
	font-size: 12px;
}

dd {
	margin: 0;
	min-width: 0;
}

.note {
	white-space: pre-wrap;
}

.link {
	cursor: pointer;
	color: var(--ui-color-primary-500);
	text-align: left;
}

.link:hover {
	text-decoration: underline;
}

.d-actions {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}

.hint {
	margin-top: 8px;
	font-size: 12px;
}
</style>
