<script setup lang="ts">
import type { DeliveryRecord, EffectiveVersion, ReceivedPdf } from '@shared/api'
import { addDays, effectivePeriods, inForceAt, KIND_COLORS, type DueEventInput, type Occurrence } from '@shared/schedule'
import { FORGE_LABEL } from '@shared/forge'
import { isEnabled } from '@shared/experiments'
import type { ReceivedCdsign } from '@shared/mdsig'
import { useApp } from '~/stores/app'
import { usePane } from '~/composables/usePane'
import { useSchedule } from '~/composables/useSchedule'
import { useVerticalResize } from '~/composables/useVerticalResize'
import { vLiveStyle } from '~/utils/live-style'
import { useStoredRef } from '~/composables/useStoredRef'
import { daysUntil, firstLine, fmtDate, untilLabel } from '~/utils/format'
import { todayISO } from '@shared/date'
import { useT } from '~/composables/useT'
import type { TimelineBand, TimelineItem } from '~/components/TimelineChart.vue'

const app = useApp()
const t = useT()
const path = app.currentPath!
const listPane = usePane('releases', { size: 380, min: 280, max: 720 })
const versions = ref<EffectiveVersion[]>([])
const deliveries = ref<DeliveryRecord[]>([])
const loaded = ref(false)
const delivering = ref<{ oid: string; baseOid?: string; date?: string } | null>(null)
const removing = ref<EffectiveVersion | null>(null)
const sel = ref<{ kind: 'v' | 'd' | 'e'; id: string } | null>(null)
const strip = useVerticalResize('clausedown.pane.releasesTimeline', 132, { min: 80, max: () => Math.round(window.innerHeight * 0.7), grow: 'down' })

const s = useSchedule()
const showTimeline = useStoredRef('clausedown.releases.timeline', true)
const docItems = computed(() => s.items.value.filter((o) => o.docPath === path))
const timelineItems = computed<TimelineItem[]>(() => docItems.value.map((o) => ({ ...o, row: 'doc', movable: o.source === 'event' && !o.repeat })))
const dueList = computed(() => {
    const from = addDays(todayISO(), -60)
    const to = addDays(todayISO(), 365)
    return docItems.value.filter((o) => o.source === 'event' && (o.overdue || ((o.end ?? o.date) >= from && o.date <= to)))
})
const selDue = computed(() => (sel.value?.kind === 'e' ? docItems.value.find((o) => o.key === sel.value!.id) : undefined))
const selDueEvent = computed(() => (selDue.value ? s.eventOf(selDue.value.id) : undefined))
function pick(o: Occurrence) {
    if (o.source === 'event') sel.value = { kind: 'e', id: o.key }
    else if (o.source === 'tag') {
        const v = versions.value.find((x) => x.date === o.date)
        if (v) sel.value = { kind: 'v', id: v.tag }
    } else sel.value = { kind: 'd', id: o.id }
}
const editing = ref<null | { event?: string; date?: string }>(null)
async function savedDue(input: DueEventInput) {
    if (await s.save(input)) editing.value = null
}
const removingDue = ref<string | null>(null)
async function removeDue() {
    const id = removingDue.value!
    removingDue.value = null
    editing.value = null
    await s.remove(id)
    if (sel.value?.kind === 'e') sel.value = null
}

async function load() {
    ;[versions.value, deliveries.value] = await Promise.all([window.api.listEffective(app.repoDir!, path), window.api.listDeliveries(app.repoDir!, path)])
    loaded.value = true
    const want = app.releasesSelect && versions.value.find((v) => v.date === app.releasesSelect)
    app.releasesSelect = null
    if (want) sel.value = { kind: 'v', id: want.tag }
    const cur = sel.value
    const still = cur && (cur.kind === 'e' || (cur.kind === 'v' ? versions.value.some((v) => v.tag === cur.id) : deliveries.value.some((d) => d.id === cur.id)))
    if (!still)
        sel.value = versions.value[0] ? { kind: 'v', id: versions.value[0].tag } : deliveries.value[0] ? { kind: 'd', id: deliveries.value[0].id } : null
}
onMounted(load)

const today = todayISO()
const periods = computed(() => effectivePeriods(versions.value.map((v) => ({ docPath: path, date: v.date, oid: v.oid, message: v.message }))))
const bands = computed<TimelineBand[]>(() => periods.value.map((p) => ({ ...p, row: 'doc' })))
const untilOf = (v: EffectiveVersion) => periods.value.find((p) => p.date === v.date)?.until ?? null
const currentTag = computed(() => {
    const p = inForceAt(periods.value, path, today)
    return p ? versions.value.find((v) => v.date === p.date)?.tag : undefined
})
function pickBand(b: TimelineBand) {
    const v = versions.value.find((x) => x.date === b.date)
    if (v) sel.value = { kind: 'v', id: v.tag }
}
const stateOf = (v: EffectiveVersion) => (v.date > today ? 'upcoming' : v.tag === currentTag.value ? 'current' : 'past')
const STATE = computed<Record<string, { label: string; color: 'primary' | 'success' | 'neutral' }>>(() => ({
    upcoming: { label: t.value.releases.state.upcoming, color: 'primary' },
    current: { label: t.value.releases.state.current, color: 'success' },
    past: { label: t.value.releases.state.past, color: 'neutral' },
}))
const previousOf = (v: EffectiveVersion) => versions.value[versions.value.indexOf(v) + 1]

const selVersion = computed(() => (sel.value?.kind === 'v' ? versions.value.find((v) => v.tag === sel.value!.id) : undefined))
const selDelivery = computed(() => (sel.value?.kind === 'd' ? deliveries.value.find((d) => d.id === sel.value!.id) : undefined))
const demo = isDemo()
const received = ref<ReceivedPdf | null>(null)
async function pickReceived() {
    received.value = (await app.run(() => window.api.pickReceivedPdf())) ?? null
}
const cdsign = computed(() => isEnabled(app.settings, 'cdsign'))
const cdsignExport = ref(false)
const cdsignFile = ref<ReceivedCdsign | null>(null)
async function pickCdsignFile() {
    if (!app.repoDir || !selDelivery.value) return
    cdsignFile.value = (await app.run(() => window.api.pickCdsign(app.repoDir!, selDelivery.value!.id))) ?? null
}
const selOid = computed(() => selVersion.value?.oid ?? selDelivery.value?.oid)

const content = ref<string | null | undefined>(undefined)
watch(
    selOid,
    async (oid) => {
        content.value = undefined
        if (!oid) return
        const text = await window.api.readAt(app.repoDir!, oid, path).catch(() => null)
        if (selOid.value === oid) content.value = text
    },
    { immediate: true },
)

async function remove() {
    const v = removing.value!
    removing.value = null
    await app.run(() => window.api.removeEffective(app.repoDir!, path, v.date), t.value.releases.removedEffective(fmtDate(v.date, 'ymd')))
    await load()
    app.touchSchedule(app.repoDir!)
}

async function delivered() {
    delivering.value = null
    await load()
    app.touchSchedule(app.repoDir!)
    if (deliveries.value[0]) sel.value = { kind: 'd', id: deliveries.value[0].id }
}

const deliverVersion = (v: EffectiveVersion) => (delivering.value = { oid: v.oid, baseOid: previousOf(v)?.oid, date: v.date })
const deliverLatest = () => app.mainBranch && (delivering.value = { oid: app.mainBranch.oid, baseOid: versions.value[0]?.oid })
const openFolder = (p: string) => app.run(() => window.api.openPath(p))
const openUrl = (u: string) => window.api.openExternal(u)
const forgeOf = (d: DeliveryRecord) => FORGE_LABEL[d.releaseForge ?? 'github']

const itemsOf = (d: DeliveryRecord) => d.items.map((x) => (t.value.releases.item as Record<string, string>)[x] ?? x)
const versionLabel = (oid: string, date?: string) => (date ? t.value.releases.effectiveVersion(date) : t.value.releases.version(oid.slice(0, 7)))
</script>

<template>
    <div class="wrap">
        <TimelineChart
            v-if="showTimeline"
            class="strip"
            v-live-style="() => ({ height: `${strip.height.value}px` })"
            :rows="[{ id: 'doc', label: '' }]"
            :items="timelineItems"
            :bands="bands"
            :as-of="selVersion?.date ?? null"
            bare
            :kind-of="s.kindOf.value"
            :selected="sel?.kind === 'e' ? sel.id : null"
            storage-key="doc"
            @select="pick"
            @band="pickBand"
            @add="({ date }) => (editing = { date })"
            @move="(o, d) => s.move(o, d)"
        >
            <template #tools>
                <UButton :label="t.schedule.add" icon="i-lucide-calendar-plus" size="xs" @click="editing = {}" />
                <UButton
                    :label="t.releases.allDocsDue"
                    icon="i-lucide-calendar-range"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    data-guide="schedule"
                    @click="app.openSchedule()"
                />
            </template>
        </TimelineChart>
        <div
            v-if="showTimeline"
            class="strip-grip"
            :class="{ dragging: strip.dragging.value }"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="t.releases.resizeTimeline"
            :title="t.releases.resizeTimeline"
            @pointerdown="strip.down"
            @pointermove="strip.move"
            @pointerup="strip.up"
            @pointercancel="strip.up"
            @dblclick="strip.reset"
        />
        <div class="releases">
            <SidePane :pane="listPane" side="left" :label="t.releases.pane" icon="i-lucide-calendar-check">
                <template #bar>
                    <UTooltip :text="showTimeline ? t.releases.hideTimeline : t.releases.showTimeline">
                        <UButton
                            icon="i-lucide-gantt-chart"
                            size="xs"
                            square
                            color="neutral"
                            :variant="showTimeline ? 'soft' : 'ghost'"
                            :aria-label="showTimeline ? t.releases.hideTimeline : t.releases.showTimeline"
                            @click="showTimeline = !showTimeline"
                        />
                    </UTooltip>
                </template>
                <div class="cd-list-group">
                    <SectionHead :label="t.releases.due" icon="i-lucide-calendar-clock" :count="dueList.length" pinned>
                        <UTooltip :text="t.releases.addDueHere">
                            <UButton icon="i-lucide-plus" size="xs" square color="neutral" variant="ghost" :aria-label="t.schedule.add" @click="editing = {}" />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="s.loaded.value && !dueList.length" class="cd-muted empty">
                        {{ t.releases.dueEmpty }}
                    </p>
                    <OccurrenceRow
                        v-for="o in dueList"
                        :key="o.key"
                        :o="o"
                        :kind="s.kindOf.value(o.kind)"
                        :active="sel?.kind === 'e' && sel.id === o.key"
                        @click="sel = { kind: 'e', id: o.key }"
                        @toggle="s.toggleDone(o)"
                    />
                </div>

                <div class="cd-list-group">
                    <SectionHead :label="t.releases.versions" icon="i-lucide-calendar-check" :count="versions.length" pinned>
                        <UTooltip :text="t.releases.setEffectiveTip">
                            <UButton
                                icon="i-lucide-calendar-plus"
                                size="xs"
                                square
                                color="neutral"
                                variant="ghost"
                                :aria-label="t.releases.setEffective"
                                data-guide="effective"
                                @click="app.view = 'history'"
                            />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="loaded && !versions.length" class="cd-muted empty">
                        {{ t.releases.versionsEmpty }}
                    </p>
                    <ListRow v-for="v in versions" :key="v.tag" :active="sel?.kind === 'v' && sel.id === v.tag" @click="sel = { kind: 'v', id: v.tag }">
                        <template #lead>
                            <DateTile :date="v.date" :active="stateOf(v) === 'current'" :fade-past="stateOf(v) === 'past'" />
                        </template>
                        <IssueText :text="firstLine(v.message)" />
                        <template #sub
                            >{{ v.author }}<template v-if="v.date >= today">{{ t.common.sep }}{{ untilLabel(daysUntil(v.date, today)) }}</template
                            ><template v-if="untilOf(v)">{{ t.common.sep }}{{ t.releases.until(fmtDate(untilOf(v)!, 'ymd')) }}</template></template
                        >
                        <template #trail>
                            <UBadge v-if="stateOf(v) !== 'past'" :label="STATE[stateOf(v)].label" :color="STATE[stateOf(v)].color" variant="subtle" size="sm" />
                        </template>
                    </ListRow>
                </div>

                <div class="cd-list-group">
                    <SectionHead :label="t.releases.deliveries" icon="i-lucide-package-check" :count="deliveries.length" pinned>
                        <UTooltip :text="t.releases.deliverLatestTip">
                            <UButton
                                icon="i-lucide-package-plus"
                                size="xs"
                                square
                                color="neutral"
                                variant="ghost"
                                :aria-label="t.releases.deliverLatest"
                                data-guide="deliver"
                                :disabled="!app.mainBranch"
                                @click="deliverLatest"
                            />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="loaded && !deliveries.length" class="cd-muted empty">
                        {{ t.releases.deliveriesEmpty }}
                    </p>
                    <ListRow
                        v-for="d in deliveries"
                        :key="d.id"
                        icon="i-lucide-package"
                        :active="sel?.kind === 'd' && sel.id === d.id"
                        @click="sel = { kind: 'd', id: d.id }"
                    >
                        {{ d.to || t.releases.noRecipient }}
                        <template #sub>{{ fmtDate(d.at, 'ymd') }}{{ t.common.sep }}{{ versionLabel(d.oid, d.effectiveDate) }}</template>
                        <template #trail>
                            <UIcon v-if="d.releaseError" name="i-lucide-triangle-alert" class="err" :title="t.releases.notPublished(forgeOf(d))" />
                        </template>
                    </ListRow>
                </div>
            </SidePane>

            <div class="detail">
                <template v-if="selDue">
                    <div class="cd-toolbar bar">
                        <div class="what">
                            <span class="due-kind" :style="{ '--k': KIND_COLORS[s.kindOf.value(selDue.kind).color] }">{{
                                s.kindOf.value(selDue.kind).label
                            }}</span>
                            <strong>{{ selDue.title }}</strong>
                            <UBadge v-if="selDue.overdue" :label="t.schedule.overdue" color="error" variant="subtle" size="sm" />
                            <UBadge v-else-if="selDue.done" :label="t.schedule.done" color="success" variant="subtle" size="sm" />
                        </div>
                        <UButton
                            v-if="selDue.task"
                            :label="selDue.done ? t.schedule.undoDone : t.schedule.markDone"
                            :icon="selDue.done ? 'i-lucide-undo-2' : 'i-lucide-check'"
                            size="sm"
                            :color="selDue.done ? 'neutral' : 'primary'"
                            :variant="selDue.done ? 'outline' : 'solid'"
                            @click="s.toggleDone(selDue)"
                        />
                        <UButton
                            :label="t.schedule.edit"
                            icon="i-lucide-pencil"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="editing = { event: selDue.id }"
                        />
                        <UButton :label="t.schedule.remove" icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="removingDue = selDue.id" />
                    </div>
                    <dl class="facts">
                        <dt>{{ t.schedule.f.date }}</dt>
                        <dd>
                            {{ selDue.end ? t.schedule.span(fmtDate(selDue.date, 'ymd'), fmtDate(selDue.end, 'ymd')) : fmtDate(selDue.date, 'ymd') }}
                            <span class="cd-muted">{{ t.schedule.paren(untilLabel(daysUntil(selDue.date, today))) }}</span>
                        </dd>
                        <template v-if="selDueEvent?.repeat">
                            <dt>{{ t.schedule.f.repeat }}</dt>
                            <dd>
                                {{
                                    t.schedule.repeat(selDueEvent.repeat.every, selDueEvent.repeat.until ? fmtDate(selDueEvent.repeat.until, 'ymd') : undefined)
                                }}
                            </dd>
                        </template>
                        <dt>{{ t.schedule.f.notify }}</dt>
                        <dd>{{ t.schedule.remind(selDue.remind) }}</dd>
                        <template v-if="selDue.note">
                            <dt>{{ t.schedule.f.memo }}</dt>
                            <dd class="memo">{{ selDue.note }}</dd>
                        </template>
                        <template v-if="selDueEvent">
                            <dt>{{ t.schedule.f.record }}</dt>
                            <dd class="cd-muted">{{ selDueEvent.by }}{{ t.common.sep }}{{ fmtDate(selDueEvent.updatedAt, 'ymdhm') }}</dd>
                        </template>
                    </dl>
                </template>

                <template v-else-if="selVersion">
                    <div class="cd-toolbar bar">
                        <div class="what">
                            <strong>{{ t.releases.effectiveOn(fmtDate(selVersion.date, 'ymd')) }}</strong>
                            <UBadge :label="STATE[stateOf(selVersion)].label" :color="STATE[stateOf(selVersion)].color" variant="subtle" size="sm" />
                            <span class="cd-muted msg" :title="selVersion.message">
                                <IssueText :text="firstLine(selVersion.message)" />{{ t.common.sep }}{{ selVersion.author }}
                            </span>
                        </div>
                        <UButton
                            v-if="previousOf(selVersion)"
                            :label="t.releases.compareWith(fmtDate(previousOf(selVersion)!.date, 'ymd'))"
                            icon="i-lucide-columns-2"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            data-guide="compare"
                            @click="app.openCompare(previousOf(selVersion)!.oid, selVersion.oid)"
                        />
                        <UButton
                            :label="t.releases.compareWork"
                            icon="i-lucide-columns-2"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            data-guide="compare"
                            @click="app.openCompare(selVersion.oid, 'work')"
                        />
                        <UButton :label="t.releases.deliver" icon="i-lucide-package" size="sm" data-guide="deliver" @click="deliverVersion(selVersion)" />
                        <UTooltip :text="t.releases.versionKept">
                            <UButton
                                :label="t.releases.removeEffective"
                                icon="i-lucide-calendar-x"
                                data-guide="effective"
                                size="sm"
                                color="error"
                                variant="ghost"
                                @click="removing = selVersion"
                            />
                        </UTooltip>
                    </div>
                </template>

                <template v-else-if="selDelivery">
                    <div class="cd-toolbar bar">
                        <div class="what">
                            <strong>{{ t.releases.deliveredTo(selDelivery.to || t.releases.noRecipient) }}</strong>
                            <span class="cd-muted msg">{{ fmtDate(selDelivery.at, 'ymdhm') }}{{ t.common.sep }}{{ selDelivery.by }}</span>
                        </div>
                        <UButton
                            v-if="selDelivery.folder"
                            :label="t.releases.openFolder"
                            icon="i-lucide-folder-open"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="openFolder(selDelivery.folder)"
                        />
                        <UButton
                            v-if="!demo"
                            :label="t.signing.received.fromDelivery"
                            icon="i-lucide-file-check"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="pickReceived"
                        />
                        <template v-if="cdsign && !demo">
                            <UButton
                                :label="t.mdsig.export.fromDelivery"
                                icon="i-lucide-signature"
                                size="sm"
                                color="neutral"
                                variant="outline"
                                @click="cdsignExport = true"
                            />
                            <UButton
                                :label="t.mdsig.receive.fromDelivery"
                                icon="i-lucide-file-signature"
                                size="sm"
                                color="neutral"
                                variant="outline"
                                @click="pickCdsignFile"
                            />
                        </template>
                        <UButton
                            v-if="selDelivery.releaseUrl"
                            :label="t.releases.viewOn(forgeOf(selDelivery))"
                            :icon="selDelivery.releaseForge === 'gitlab' ? 'i-lucide-gitlab' : 'i-lucide-github'"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="openUrl(selDelivery.releaseUrl!)"
                        />
                    </div>
                    <dl class="facts">
                        <dt>{{ t.releases.givenVersion }}</dt>
                        <dd>
                            {{ versionLabel(selDelivery.oid, selDelivery.effectiveDate ? fmtDate(selDelivery.effectiveDate, 'ymd') : undefined) }}
                        </dd>
                        <dt>{{ t.releases.givenItems }}</dt>
                        <dd class="chips"><span v-for="x in itemsOf(selDelivery)" :key="x" class="cd-chip">{{ x }}</span></dd>
                        <template v-if="selDelivery.memo">
                            <dt>{{ t.schedule.f.memo }}</dt>
                            <dd class="memo">{{ selDelivery.memo }}</dd>
                        </template>
                        <template v-if="selDelivery.received?.length">
                            <dt>{{ t.signing.received.record }}</dt>
                            <dd>
                                <div v-for="(x, i) in selDelivery.received" :key="i">
                                    {{ t.signing.received.recordRow(x.file, x.by) }}<span class="cd-muted">{{ t.common.sep }}{{ fmtDate(x.at, 'ymdhm') }}</span>
                                    <div v-if="x.signers.length" class="cd-muted">{{ t.signing.received.signers(x.signers.join(t.common.sep)) }}</div>
                                    <div v-if="x.kind === 'cdsign' && x.agreement" class="cd-muted">
                                        {{ t.mdsig.pane.agreement.title }}{{ t.common.sep }}{{ t.mdsig.receive.agreement[x.agreement] }}
                                    </div>
                                </div>
                            </dd>
                        </template>
                        <template v-if="selDelivery.releaseError">
                            <dt>{{ forgeOf(selDelivery) }}</dt>
                            <dd class="error">{{ t.releases.publishError(selDelivery.releaseError) }}</dd>
                        </template>
                    </dl>
                </template>

                <DocPaper v-if="selOid" :text="content" :doc-path="path" />
                <div v-else-if="loaded && !selDue" class="none">
                    <UIcon name="i-lucide-calendar-check" class="big" />
                    <p>{{ t.releases.emptyDetail }}</p>
                    <div class="row">
                        <UButton
                            :label="t.releases.setFromHistory"
                            icon="i-lucide-calendar-plus"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            data-guide="effective"
                            @click="app.view = 'history'"
                        />
                        <UButton
                            v-if="app.mainBranch"
                            :label="t.releases.deliverLatest"
                            icon="i-lucide-package"
                            size="sm"
                            data-guide="deliver"
                            @click="deliverLatest"
                        />
                    </div>
                </div>
            </div>

            <DueEventModal
                v-if="editing"
                :kinds="s.kinds.value"
                :event="editing.event ? s.eventOf(editing.event) : undefined"
                :initial="{ docPath: path, date: editing.date }"
                fixed-doc
                @close="editing = null"
                @save="savedDue"
                @remove="(id) => (removingDue = id)"
            />
            <ConfirmModal
                :open="!!removingDue"
                :title="t.schedule.removeTitle"
                :confirm-label="t.schedule.remove"
                color="error"
                @update:open="(v) => !v && (removingDue = null)"
                @confirm="removeDue"
            >
                <p>{{ t.schedule.removeBody }}</p>
            </ConfirmModal>
            <DeliveryModal
                v-if="delivering"
                :path="path"
                :oid="delivering.oid"
                :base-oid="delivering.baseOid"
                :effective-date="delivering.date"
                @close="delivering = null"
                @done="delivered"
            />
            <ReceivedPdfModal v-if="received && selDelivery" :pdf="received" :delivery-id="selDelivery.id" @close="received = null" @done="load" />
            <CdsignExportModal
                v-if="cdsignExport && selDelivery"
                :path="selDelivery.docPath"
                :title="selDelivery.title"
                :oid="selDelivery.oid"
                :version-label="versionLabel(selDelivery.oid, selDelivery.effectiveDate ? fmtDate(selDelivery.effectiveDate, 'ymd') : undefined)"
                @close="cdsignExport = false"
            />
            <CdsignReceiveModal v-if="cdsignFile && selDelivery" :file="cdsignFile" :delivery-id="selDelivery.id" @close="cdsignFile = null" @done="load" />
            <ConfirmModal
                :open="!!removing"
                :title="t.releases.removeEffective"
                :confirm-label="t.releases.removeEffectiveConfirm"
                color="error"
                @update:open="(v) => !v && (removing = null)"
                @confirm="remove"
            >
                <p>{{ t.releases.removeEffectiveBody(removing?.date ?? '') }}</p>
            </ConfirmModal>
        </div>
    </div>
</template>

<style scoped>
.wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.strip {
    flex: 0 0 auto;
    border-bottom: 1px solid var(--ui-border);
}

.strip-grip {
    position: relative;
    z-index: 3;
    flex: 0 0 auto;
    height: 6px;
    margin: -3px 0;
    cursor: row-resize;
}

.strip-grip:hover,
.strip-grip.dragging {
    background: color-mix(in oklab, var(--ui-color-primary-500) 40%, transparent);
}

.releases {
    flex: 1;
    min-height: 0;
    display: flex;
}

.due-kind {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
}

.due-kind::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: 2px;
    transform: rotate(45deg);
    background: var(--k);
}

.empty {
    padding: 0 12px 8px;
}

.err {
    color: var(--ui-color-error-500);
}

.detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.bar {
    flex-wrap: nowrap;
}

.bar :deep(button) {
    flex-shrink: 0;
}

.what {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
}

.what > strong,
.what > :deep(span:not(.msg)) {
    flex-shrink: 0;
    white-space: nowrap;
}

.msg {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0;
    padding: 10px 16px;
    font-size: 13px;
    border-bottom: 1px solid var(--ui-border);
}

dt {
    color: var(--ui-text-muted);
    font-size: 12px;
}

dd {
    margin: 0;
    min-width: 0;
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.memo {
    white-space: pre-wrap;
}

.error {
    color: var(--ui-color-error-500);
}

.none {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.big {
    width: 32px;
    height: 32px;
    color: var(--ui-text-dimmed);
}

.row {
    display: flex;
    gap: 8px;
}
</style>
