<script setup lang="ts">
import type { RepoEntry } from '@shared/api'
import type { EventKind, ScheduleItem } from '@shared/schedule'
import type { RecentDoc } from '@shared/prefs'
import { groupRepos } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { baseName } from '~/utils/folders'
import { fmtDate, todayISO } from '~/utils/format'

const app = useApp()
const t = useT()
const today = todayISO()
onMounted(() => app.checkRepos())

const repos = computed(() => app.settings?.repos ?? [])
const repoGroups = computed(() => groupRepos(repos.value))
const stateOf = (r: RepoEntry) => app.repoStates[r.dir] ?? 'ok'
const missingRepos = computed(() => repos.value.filter((r) => stateOf(r) !== 'ok'))
const repoName = (dir: string) => repos.value.find((r) => r.dir === dir)?.name ?? dir
const ready = computed(() => !!app.repoDir && !app.repoProblem)
const repoSub = (r: RepoEntry) =>
    stateOf(r) === 'missing'
        ? t.value.home.repoMissing
        : stateOf(r) === 'notGit'
          ? t.value.home.repoNotGit
          : r.url?.replace(/^https?:\/\//, '').replace(/\.git$/, '') || t.value.home.localOnly

const now = new Date()
const dateLine = computed(() => t.value.home.dateLine(now))
const hello = computed(() => {
    const h = now.getHours()
    const m = t.value.home
    const g = h < 10 ? m.greeting.morning : h < 18 ? m.greeting.day : m.greeting.evening
    return app.me ? m.helloName(app.me, g) : g
})

const steps = computed(() => [
    {
        done: !!app.me,
        label: t.value.home.steps.login,
        sub: t.value.home.steps.loginSub,
        action: () => app.openSettings('setup', app.accounts.some((a) => a.login) ? 'profile' : 'remote'),
    },
    { done: repos.value.length > 0, label: t.value.home.steps.addRepo, sub: t.value.home.steps.addRepoSub, action: addRepo },
])
const showSteps = computed(() => !steps.value[0].done || !steps.value[1].done)
const scheduleTab = computed(() => !showSteps.value && app.homeTab === 'schedule')

const isMissing = (d: RecentDoc) => (app.repoStates[d.dir] ?? 'ok') !== 'ok'
const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
const DAY = 86400000
const recentGroups = computed(() => {
    const groups: { label: string; items: RecentDoc[] }[] = []
    const g = t.value.home.recentGroup
    for (const d of (app.prefs.recentDocs ?? []).filter((d) => repos.value.some((r) => r.dir === d.dir))) {
        const label = d.at >= dayStart ? g.today : d.at >= dayStart - DAY ? g.yesterday : d.at >= dayStart - 6 * DAY ? g.thisWeek : g.earlier
        if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(d)
        else groups.push({ label, items: [d] })
    }
    return groups
})
const when = (ms: number) =>
    ms >= dayStart - DAY ? `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, '0')}` : fmtDate(Math.floor(ms / 1000), 'md')

const SHOW = 8
const upcoming = ref<ScheduleItem[] | null>(null)
let upcomingSeq = 0
async function loadUpcoming() {
    const n = ++upcomingSeq
    const list = await window.api.scheduleAll(today, 90).catch(() => [])
    if (n === upcomingSeq) upcoming.value = list
}
watch(() => [repos.value.map((r) => r.dir).join('|'), app.reloadKey, app.scheduleKey], loadUpcoming, { immediate: true })
const overdueCount = computed(() => upcoming.value?.filter((u) => u.overdue).length ?? 0)
const kindOf = (u: ScheduleItem): EventKind => ({ id: u.kind, label: u.kindLabel, color: u.color, task: u.task, remind: u.remind })
const where = (u: ScheduleItem) => `${u.repo}${t.value.common.sep}${u.docPath ? baseName(u.docPath).replace(/\.md$/i, '') : t.value.home.wholeRepo}`
const openUpcoming = (u: ScheduleItem) => app.openSchedule(u.dir)
async function toggleDone(u: ScheduleItem) {
    const ok = await app.runOk(() => window.api.setEventDone(u.dir, u.id, u.date, !u.done))
    if (ok) app.touchSchedule(u.dir)
}

function openRepo(r: RepoEntry) {
    if (r.dir !== app.repoDir) void app.switchRepo(r.dir)
    else app.view = 'docs'
}
function addRepo() {
    app.openSettings('setup', 'repos')
}
</script>

<template>
    <div class="top">
        <header class="hero">
            <div class="brand">
                <BrandLogo class="logo" />
                <p class="tagline">{{ t.home.tagline }}</p>
            </div>
            <div class="greet">
                <span class="date">{{ dateLine }}</span>
                <strong class="hello">{{ hello }}</strong>
            </div>
            <button class="search" data-guide="search" @click="app.paletteOpen = true">
                <UIcon name="i-lucide-search" />
                <span>{{ t.home.search }}</span>
                <span class="cd-grow" />
                <UKbd value="meta" />
                <UKbd value="K" />
            </button>
            <div class="quick">
                <UButton v-if="ready" :label="t.common.newDoc" icon="i-lucide-file-plus" @click="app.dialog = { kind: 'newDoc' }" />
                <UButton
                    v-if="ready"
                    :label="t.home.repoHomeOf(app.repo?.name)"
                    icon="i-lucide-layout-grid"
                    color="neutral"
                    variant="outline"
                    class="repo-btn"
                    data-guide="docs"
                    @click="app.view = 'docs'"
                />
                <UButton
                    :label="t.home.addRepo"
                    icon="i-lucide-archive"
                    :color="ready ? 'neutral' : 'primary'"
                    :variant="ready ? 'outline' : 'solid'"
                    @click="addRepo"
                />
                <UButton :label="t.common.settings" icon="i-lucide-settings" color="neutral" variant="ghost" @click="app.view = 'setup'" />
            </div>
        </header>

        <div v-if="missingRepos.length" class="alerts">
            <UAlert
                v-for="r in missingRepos"
                :key="r.dir"
                color="warning"
                variant="subtle"
                icon="i-lucide-folder-x"
                :title="t.home.missing.title(r.name)"
                :description="t.home.missing.description(r.dir)"
                :actions="[
                    { label: t.home.missing.relocate, color: 'warning', variant: 'solid', size: 'xs', onClick: () => app.relocateRepo(r.dir) },
                    { label: t.home.missing.forget, color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => app.forgetRepo(r.dir) },
                ]"
            />
        </div>

        <div class="body">
            <section class="cd-pane-col main">
                <div class="cd-pane-bar">
                    <span v-if="showSteps" class="cd-pane-title">{{ t.home.steps.title }}</span>
                    <SegmentSwitch
                        v-else
                        v-model="app.homeTab"
                        size="xs"
                        :aria-label="t.home.leftPane"
                        :items="[
                            { value: 'recent', label: t.home.tabRecent, icon: 'i-lucide-history' },
                            { value: 'schedule', label: t.home.tabSchedule, icon: 'i-lucide-calendar-days' },
                        ]"
                    />
                </div>
                <ScheduleView v-if="scheduleTab" all class="embed" />
                <div v-else class="scroll">
                    <ol v-if="showSteps" class="steps">
                        <li v-for="(s, i) in steps" :key="s.label" :class="{ done: s.done }">
                            <span class="num">
                                <UIcon v-if="s.done" name="i-lucide-check" />
                                <template v-else>{{ i + 1 }}</template>
                            </span>
                            <span class="what">
                                <strong>{{ s.label }}</strong>
                                <span class="cd-muted">{{ s.sub }}</span>
                            </span>
                            <UButton v-if="!s.done" :label="t.home.steps.setUp" size="xs" color="neutral" variant="outline" @click="s.action" />
                        </li>
                    </ol>

                    <template v-else>
                        <div v-if="!recentGroups.length" class="empty-big">
                            <UIcon name="i-lucide-file-text" class="big" />
                            <p>{{ t.home.recentEmpty }}</p>
                            <UButton
                                v-if="ready"
                                :label="t.home.pickInRepoHome"
                                icon="i-lucide-layout-grid"
                                data-guide="docs"
                                size="sm"
                                color="neutral"
                                variant="outline"
                                @click="app.view = 'docs'"
                            />
                        </div>
                        <div v-for="g in recentGroups" :key="g.label" class="cd-list-group">
                            <SectionHead :label="g.label" pinned />
                            <ListRow
                                v-for="d in g.items"
                                :key="d.dir + d.path"
                                icon="i-lucide-file-text"
                                :dim="isMissing(d)"
                                :disabled="isMissing(d)"
                                @click="app.openRecent(d)"
                            >
                                {{ d.title }}
                                <template #sub>{{ repoName(d.dir) }} ／ {{ d.path }}</template>
                                <template #trail>
                                    <span class="when">{{ isMissing(d) ? t.home.noRepo : when(d.at) }}</span>
                                </template>
                            </ListRow>
                        </div>
                    </template>
                </div>
            </section>

            <section v-if="!scheduleTab" class="cd-pane-col side">
                <div class="scroll">
                    <div class="cd-list-group">
                        <SectionHead :label="t.home.upcoming" icon="i-lucide-calendar-clock" :count="upcoming?.length" pinned>
                            <UBadge v-if="overdueCount" :label="t.home.overdueBadge(overdueCount)" color="error" variant="subtle" size="sm" />
                            <UTooltip :text="t.home.timelineAll">
                                <UButton
                                    icon="i-lucide-calendar-days"
                                    size="xs"
                                    square
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t.home.tabSchedule"
                                    data-guide="schedule"
                                    @click="app.openScheduleAll()"
                                />
                            </UTooltip>
                        </SectionHead>
                        <p v-if="upcoming && !upcoming.length" class="cd-muted empty">{{ t.home.upcomingEmpty }}</p>
                        <OccurrenceRow
                            v-for="u in (upcoming ?? []).slice(0, SHOW)"
                            :key="u.dir + u.key"
                            :o="u"
                            :kind="kindOf(u)"
                            :where="where(u)"
                            @click="openUpcoming(u)"
                            @toggle="toggleDone(u)"
                        />
                        <p v-if="(upcoming?.length ?? 0) > SHOW" class="cd-muted empty">{{ t.common.moreCount(upcoming!.length - SHOW) }}</p>
                    </div>

                    <div v-if="app.toReview.length" class="cd-list-group">
                        <SectionHead :label="t.home.toReview" icon="i-lucide-message-square-check" :count="app.toReview.length" pinned />
                        <ListRow
                            v-for="b in app.toReview"
                            :key="b.name"
                            icon="i-lucide-file-pen-line"
                            class="draft"
                            @click="app.dialog = { kind: 'review', branch: b.name }"
                        >
                            {{ b.label }}
                            <template #sub>{{ app.repo?.name }}{{ t.common.sep }}{{ t.home.requestedBy(app.statusOf(b).request?.by ?? '') }}</template>
                            <template #trail>
                                <UBadge :label="t.home.reviewNow" color="primary" variant="subtle" size="sm" />
                            </template>
                        </ListRow>
                    </div>

                    <div class="cd-list-group">
                        <SectionHead :label="t.home.repos" icon="i-lucide-archive" :count="repos.length" pinned>
                            <UTooltip :text="t.home.addRepo">
                                <UButton icon="i-lucide-plus" size="xs" square color="neutral" variant="ghost" :aria-label="t.home.addRepo" @click="addRepo" />
                            </UTooltip>
                        </SectionHead>
                        <p v-if="!repos.length" class="cd-muted empty">{{ t.home.reposEmpty }}</p>
                        <template v-for="g in repoGroups" :key="g.section || '-'">
                            <div v-if="g.section" class="repo-sec">
                                <UIcon name="i-lucide-folder" />{{ g.section }}<span class="n">{{ g.repos.length }}</span>
                            </div>
                            <ListRow
                                v-for="r in g.repos"
                                :key="r.dir"
                                :active="r.dir === app.repoDir"
                                :title="r.dir"
                                :icon="stateOf(r) !== 'ok' ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive'"
                                :class="{ warn: stateOf(r) !== 'ok' }"
                                @click="stateOf(r) === 'ok' ? openRepo(r) : app.relocateRepo(r.dir)"
                            >
                                {{ r.name }}
                                <template #sub>{{ repoSub(r) }}</template>
                                <template v-if="r.dir === app.repoDir && stateOf(r) === 'ok'" #trail>
                                    <UBadge :label="t.home.inUse" size="sm" variant="subtle" />
                                </template>
                            </ListRow>
                        </template>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.repo-sec {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-muted);
}

.repo-sec .n {
    font-weight: 400;
    color: var(--ui-text-dimmed);
}

.top {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
        'brand greet'
        'search search'
        'quick quick';
    gap: 14px 24px;
    flex-shrink: 0;
    padding: 28px 32px 20px;
    border-bottom: 1px solid var(--ui-border);
    background: radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--cd-brand) 9%, transparent), transparent 60%), var(--ui-bg);
}

.brand {
    grid-area: brand;
    min-width: 0;
}

.logo {
    height: 44px;
    width: auto;
    color: var(--cd-brand);
}

.tagline {
    margin: 6px 0 0;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.greet {
    grid-area: greet;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 2px;
    text-align: right;
}

.date {
    font-size: 12px;
    color: var(--ui-text-muted);
    font-variant-numeric: tabular-nums;
}

.hello {
    font-size: 18px;
}

.search {
    grid-area: search;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 640px;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--ui-border-accented);
    border-radius: 10px;
    background: var(--ui-bg);
    color: var(--ui-text-muted);
    font-size: 14px;
    cursor: text;
    transition:
        border-color 0.15s,
        box-shadow 0.15s;
}

.search:hover {
    border-color: var(--ui-color-primary-500);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--ui-color-primary-500) 15%, transparent);
}

.quick {
    grid-area: quick;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.repo-btn {
    max-width: 320px;
}

.alerts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 16px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--ui-border);
}

.body {
    flex: 1;
    min-height: 0;
    display: flex;
}

.main {
    flex: 1 1 0;
}

.side {
    flex: 0 0 380px;
    border-left: 1px solid var(--ui-border);
}

@media (max-width: 1000px) {
    .side {
        flex-basis: 300px;
    }

    .hero {
        padding: 20px 20px 16px;
    }
}

.embed {
    flex: 1;
    min-height: 0;
    height: auto;
}

.scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 8px;
}

.empty {
    padding: 4px 12px 8px;
}

.when {
    font-size: 11px;
    color: var(--ui-text-dimmed);
    font-variant-numeric: tabular-nums;
}

.draft :deep(.ic) {
    color: var(--cd-draft);
}

.warn :deep(.ic) {
    color: var(--ui-color-warning-500);
}

.steps {
    list-style: none;
    margin: 0;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 640px;
}

.steps li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 10px;
}

.steps li.done {
    opacity: 0.6;
}

.num {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-size: 13px;
    font-weight: 700;
    color: var(--ui-color-primary-500);
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
}

.done .num {
    color: var(--ui-color-success-600);
    background: color-mix(in oklab, var(--ui-color-success-500) 15%, transparent);
}

.what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    font-size: 13px;
}

.empty-big {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 16px;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.big {
    width: 32px;
    height: 32px;
    color: var(--ui-text-dimmed);
}
</style>
