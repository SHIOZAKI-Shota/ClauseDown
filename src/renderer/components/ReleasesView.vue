<script setup lang="ts">
import type { DeliveryRecord, EffectiveVersion } from '@shared/api'
import { addDays, effectivePeriods, inForceAt, KIND_COLORS, type DueEventInput, type Occurrence } from '@shared/schedule'
import { FORGE_LABEL } from '@shared/forge'
import { useApp } from '~/stores/app'
import { usePane } from '~/composables/usePane'
import { useSchedule } from '~/composables/useSchedule'
import { useStoredRef } from '~/composables/useStoredRef'
import { daysUntil, firstLine, fmtDate, todayISO, untilLabel } from '~/utils/format'
import type { TimelineBand, TimelineItem } from '~/components/TimelineChart.vue'

const app = useApp()
const path = app.currentPath!
const listPane = usePane('releases', { size: 380, min: 280, max: 720 })
const versions = ref<EffectiveVersion[]>([])
const deliveries = ref<DeliveryRecord[]>([])
const loaded = ref(false)
const delivering = ref<{ oid: string; baseOid?: string; date?: string } | null>(null)
const removing = ref<EffectiveVersion | null>(null)
const sel = ref<{ kind: 'v' | 'd' | 'e'; id: string } | null>(null)

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
const remindLabel = (n: number) => (n < 0 ? '知らせない' : n === 0 ? '当日に知らせる' : `${n} 日前から知らせる`)

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
const STATE: Record<string, { label: string; color: 'primary' | 'success' | 'neutral' }> = {
    upcoming: { label: '施行予定', color: 'primary' },
    current: { label: '施行中', color: 'success' },
    past: { label: '過去の版', color: 'neutral' },
}
const previousOf = (v: EffectiveVersion) => versions.value[versions.value.indexOf(v) + 1]

const selVersion = computed(() => (sel.value?.kind === 'v' ? versions.value.find((v) => v.tag === sel.value!.id) : undefined))
const selDelivery = computed(() => (sel.value?.kind === 'd' ? deliveries.value.find((d) => d.id === sel.value!.id) : undefined))
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
    await app.run(() => window.api.removeEffective(app.repoDir!, path, v.date), `施行日 ${v.date} を外しました`)
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

const ITEM_LABEL: Record<string, string> = {
    docPdf: '条文本体（PDF）',
    docDocx: '条文本体（Word）',
    cmpPdf: '新旧対照表（PDF）',
    cmpDocx: '新旧対照表（Word）',
}
const itemsOf = (d: DeliveryRecord) => d.items.map((x) => ITEM_LABEL[x] ?? x)
</script>

<template>
    <div class="wrap">
        <TimelineChart
            v-if="showTimeline"
            class="strip"
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
                <UButton label="期日の追加" icon="i-lucide-calendar-plus" size="xs" @click="editing = {}" />
                <UButton label="すべての文書の期日・有効期間" icon="i-lucide-calendar-range" size="xs" color="neutral" variant="ghost" @click="app.openSchedule()" />
            </template>
        </TimelineChart>
        <div class="releases">
            <SidePane :pane="listPane" side="left" label="期日・有効期間・納品" icon="i-lucide-calendar-check">
                <template #bar>
                    <UTooltip :text="showTimeline ? 'タイムラインを隠す' : 'タイムラインを出す'">
                        <UButton
                            icon="i-lucide-gantt-chart"
                            size="xs"
                            square
                            color="neutral"
                            :variant="showTimeline ? 'soft' : 'ghost'"
                            :aria-label="showTimeline ? 'タイムラインを隠す' : 'タイムラインを出す'"
                            @click="showTimeline = !showTimeline"
                        />
                    </UTooltip>
                </template>
                <div class="cd-list-group">
                    <SectionHead label="期日" icon="i-lucide-calendar-clock" :count="dueList.length" pinned>
                        <UTooltip text="この文書の期日の追加">
                            <UButton icon="i-lucide-plus" size="xs" square color="neutral" variant="ghost" aria-label="期日の追加" @click="editing = {}" />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="s.loaded.value && !dueList.length" class="cd-muted empty">
                        公布・提出・届出・申請・契約の開始や更新などの日付を記録できます。期日が近づくと通知します。
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
                    <SectionHead label="施行版" icon="i-lucide-calendar-check" :count="versions.length" pinned>
                        <UTooltip text="改定履歴で版を選んで施行日を付ける">
                            <UButton
                                icon="i-lucide-calendar-plus"
                                size="xs"
                                square
                                color="neutral"
                                variant="ghost"
                                aria-label="施行日を付ける"
                                @click="app.view = 'history'"
                            />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="loaded && !versions.length" class="cd-muted empty">
                        まだ施行版がありません。「版を保存」や「現行版に反映」のときに施行日を入れるか、改定履歴で版を選んで施行日を付けてください。
                    </p>
                    <ListRow v-for="v in versions" :key="v.tag" :active="sel?.kind === 'v' && sel.id === v.tag" @click="sel = { kind: 'v', id: v.tag }">
                        <template #lead>
                            <DateTile :date="v.date" :active="stateOf(v) === 'current'" :fade-past="stateOf(v) === 'past'" />
                        </template>
                        <IssueText :text="firstLine(v.message)" />
                        <template #sub
                            >{{ v.author }}<template v-if="v.date >= today">・{{ untilLabel(daysUntil(v.date, today)) }}</template
                            ><template v-if="untilOf(v)">・{{ fmtDate(untilOf(v)!, 'ymd') }} まで</template></template
                        >
                        <template #trail>
                            <UBadge v-if="stateOf(v) !== 'past'" :label="STATE[stateOf(v)].label" :color="STATE[stateOf(v)].color" variant="subtle" size="sm" />
                        </template>
                    </ListRow>
                </div>

                <div class="cd-list-group">
                    <SectionHead label="納品の記録" icon="i-lucide-package-check" :count="deliveries.length" pinned>
                        <UTooltip text="現行版の最新を納品する">
                            <UButton
                                icon="i-lucide-package-plus"
                                size="xs"
                                square
                                color="neutral"
                                variant="ghost"
                                aria-label="現行版の最新を納品"
                                :disabled="!app.mainBranch"
                                @click="deliverLatest"
                            />
                        </UTooltip>
                    </SectionHead>
                    <p v-if="loaded && !deliveries.length" class="cd-muted empty">
                        まだ納品の記録はありません。いつ・誰に・どの版を渡したかを残すと、リポジトリを使う全員に共有されます。
                    </p>
                    <ListRow
                        v-for="d in deliveries"
                        :key="d.id"
                        icon="i-lucide-package"
                        :active="sel?.kind === 'd' && sel.id === d.id"
                        @click="sel = { kind: 'd', id: d.id }"
                    >
                        {{ d.to || '（宛先なし）' }}
                        <template #sub
                            >{{ fmtDate(d.at, 'ymd') }}・{{
                                d.effectiveDate
                                    ? `${d.effectiveDate} 施行版`
                                    : `版
                            ${d.oid.slice(0, 7)}`
                            }}</template
                        >
                        <template #trail>
                            <UIcon v-if="d.releaseError" name="i-lucide-triangle-alert" class="err" :title="`${forgeOf(d)} に載せられませんでした`" />
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
                            <UBadge v-if="selDue.overdue" label="期限切れ" color="error" variant="subtle" size="sm" />
                            <UBadge v-else-if="selDue.done" label="済み" color="success" variant="subtle" size="sm" />
                        </div>
                        <UButton
                            v-if="selDue.task"
                            :label="selDue.done ? '済みを取り消す' : '済みにする'"
                            :icon="selDue.done ? 'i-lucide-undo-2' : 'i-lucide-check'"
                            size="sm"
                            :color="selDue.done ? 'neutral' : 'primary'"
                            :variant="selDue.done ? 'outline' : 'solid'"
                            @click="s.toggleDone(selDue)"
                        />
                        <UButton label="直す" icon="i-lucide-pencil" size="sm" color="neutral" variant="outline" @click="editing = { event: selDue.id }" />
                        <UButton label="消す" icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" @click="removingDue = selDue.id" />
                    </div>
                    <dl class="facts">
                        <dt>日付</dt>
                        <dd>
                            {{ fmtDate(selDue.date, 'ymd') }}<template v-if="selDue.end"> 〜 {{ fmtDate(selDue.end, 'ymd') }}</template>
                            <span class="cd-muted">（{{ untilLabel(daysUntil(selDue.date, today)) }}）</span>
                        </dd>
                        <template v-if="selDueEvent?.repeat">
                            <dt>繰り返し</dt>
                            <dd>
                                {{ selDueEvent.repeat.every === 'year' ? '毎年' : '毎月'
                                }}<template v-if="selDueEvent.repeat.until">（{{ fmtDate(selDueEvent.repeat.until, 'ymd') }} まで）</template>
                            </dd>
                        </template>
                        <dt>通知</dt>
                        <dd>{{ remindLabel(selDue.remind) }}</dd>
                        <template v-if="selDue.note">
                            <dt>メモ</dt>
                            <dd class="memo">{{ selDue.note }}</dd>
                        </template>
                        <template v-if="selDueEvent">
                            <dt>記録</dt>
                            <dd class="cd-muted">{{ selDueEvent.by }}・{{ fmtDate(selDueEvent.updatedAt, 'ymdhm') }}</dd>
                        </template>
                    </dl>
                </template>

                <template v-else-if="selVersion">
                    <div class="cd-toolbar bar">
                        <div class="what">
                            <strong>{{ fmtDate(selVersion.date, 'ymd') }} 施行</strong>
                            <UBadge :label="STATE[stateOf(selVersion)].label" :color="STATE[stateOf(selVersion)].color" variant="subtle" size="sm" />
                            <span class="cd-muted msg" :title="selVersion.message">
                                <IssueText :text="firstLine(selVersion.message)" />・{{ selVersion.author }}
                            </span>
                        </div>
                        <UButton
                            v-if="previousOf(selVersion)"
                            :label="`${fmtDate(previousOf(selVersion)!.date, 'ymd')} 版と比較`"
                            icon="i-lucide-columns-2"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="app.openCompare(previousOf(selVersion)!.oid, selVersion.oid)"
                        />
                        <UButton
                            label="今の文書と比較"
                            icon="i-lucide-columns-2"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="app.openCompare(selVersion.oid, 'work')"
                        />
                        <UButton label="納品する" icon="i-lucide-package" size="sm" @click="deliverVersion(selVersion)" />
                        <UTooltip text="版は消えません">
                            <UButton label="施行日を外す" icon="i-lucide-calendar-x" size="sm" color="error" variant="ghost" @click="removing = selVersion" />
                        </UTooltip>
                    </div>
                </template>

                <template v-else-if="selDelivery">
                    <div class="cd-toolbar bar">
                        <div class="what">
                            <strong>{{ selDelivery.to || '（宛先なし）' }} へ納品</strong>
                            <span class="cd-muted msg">{{ fmtDate(selDelivery.at, 'ymdhm') }}・{{ selDelivery.by }}</span>
                        </div>
                        <UButton
                            label="フォルダを開く"
                            icon="i-lucide-folder-open"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="openFolder(selDelivery.folder)"
                        />
                        <UButton
                            v-if="selDelivery.releaseUrl"
                            :label="`${forgeOf(selDelivery)} で見る`"
                            :icon="selDelivery.releaseForge === 'gitlab' ? 'i-lucide-gitlab' : 'i-lucide-github'"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="openUrl(selDelivery.releaseUrl!)"
                        />
                    </div>
                    <dl class="facts">
                        <dt>渡した版</dt>
                        <dd>
                            {{
                                selDelivery.effectiveDate
                                    ? `${fmtDate(selDelivery.effectiveDate, 'ymd')} 施行版`
                                    : `版
                            ${selDelivery.oid.slice(0, 7)}`
                            }}
                        </dd>
                        <dt>渡したもの</dt>
                        <dd class="chips"><span v-for="x in itemsOf(selDelivery)" :key="x" class="cd-chip">{{ x }}</span></dd>
                        <template v-if="selDelivery.memo">
                            <dt>メモ</dt>
                            <dd class="memo">{{ selDelivery.memo }}</dd>
                        </template>
                        <template v-if="selDelivery.releaseError">
                            <dt>{{ forgeOf(selDelivery) }}</dt>
                            <dd class="error">載せられませんでした：{{ selDelivery.releaseError }}</dd>
                        </template>
                    </dl>
                </template>

                <DocPaper v-if="selOid" :text="content" :doc-path="path" />
                <div v-else-if="loaded && !selDue" class="none">
                    <UIcon name="i-lucide-calendar-check" class="big" />
                    <p>施行日を付けた版と、納品の記録がここに並びます。</p>
                    <div class="row">
                        <UButton
                            label="改定履歴から施行日を付ける"
                            icon="i-lucide-calendar-plus"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="app.view = 'history'"
                        />
                        <UButton v-if="app.mainBranch" label="現行版の最新を納品" icon="i-lucide-package" size="sm" @click="deliverLatest" />
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
                title="期日を消す"
                confirm-label="消す"
                color="error"
                @update:open="(v) => !v && (removingDue = null)"
                @confirm="removeDue"
            >
                <p>この期日を消します。繰り返す期日なら、すべての回が消えます。</p>
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
            <ConfirmModal
                :open="!!removing"
                title="施行日を外す"
                confirm-label="外す"
                color="error"
                @update:open="(v) => !v && (removing = null)"
                @confirm="remove"
            >
                <p>{{ removing?.date }} の施行日の記録を外します。版そのものは消えません。</p>
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
    height: 132px;
    border-bottom: 1px solid var(--ui-border);
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
