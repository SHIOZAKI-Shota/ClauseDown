<script setup lang="ts">
import { addDays, dayNum, fromDayNum, KIND_COLORS, type EventKind, type Occurrence, type Period } from '@shared/schedule'
import { useStoredRef } from '~/composables/useStoredRef'
import { todayISO } from '~/utils/format'

export interface TimelineRow {
    id: string
    label: string
    sub?: string
    title?: string
}
export type TimelineItem = Occurrence & { row: string; movable?: boolean; dir?: string }
export type TimelineBand = Period & { row: string; dir?: string }

const props = withDefaults(
    defineProps<{
        rows: TimelineRow[]
        items: TimelineItem[]
        bands?: TimelineBand[]
        asOf?: string | null
        kindOf: (id: string, dir?: string) => EventKind
        selected?: string | null
        bare?: boolean
        storageKey?: string
    }>(),
    { selected: null, bare: false, storageKey: 'timeline', bands: () => [], asOf: null },
)
const emit = defineEmits<{
    select: [TimelineItem]
    add: [{ date: string; row: string }]
    move: [TimelineItem, string]
    rowClick: [TimelineRow]
    band: [TimelineBand]
    asOf: [string]
}>()

const SCALES = [
    { value: 'month', label: '月', ppd: 32 },
    { value: 'quarter', label: '四半期', ppd: 10 },
    { value: 'year', label: '年', ppd: 2.6 },
    { value: 'years', label: '5年', ppd: 0.6 },
] as const
const MIN_PPD = 0.3
const MAX_PPD = 64
const ppd = useStoredRef(`clausedown.timeline.${props.storageKey}`, 10, { delay: 400 })
const scale = computed({
    get: () => [...SCALES].sort((a, b) => Math.abs(Math.log(a.ppd / ppd.value)) - Math.abs(Math.log(b.ppd / ppd.value)))[0].value,
    set: (v) => {
        const tx = xOf(todayN)
        zoomTo(SCALES.find((s) => s.value === v)!.ppd, tx >= 0 && tx <= trackW.value ? tx : trackW.value / 2)
    },
})

const LABEL_W = 180
const LANE_H = 24
const AXIS_H = 44
const BAND_H = 12
const labelW = computed(() => (props.bare ? 0 : LABEL_W))

const today = todayISO()
const todayN = dayNum(today)
const scroller = ref<HTMLElement | null>(null)
const trackW = ref(0)
const start = ref<number | null>(null)
let ro: ResizeObserver | null = null
onMounted(() => {
    ro = new ResizeObserver(() => {
        const w = Math.max(0, (scroller.value?.clientWidth ?? 0) - labelW.value)
        trackW.value = w
        if (start.value === null && w) start.value = todayN - (w / ppd.value) * 0.25
    })
    if (scroller.value) ro.observe(scroller.value)
})
onBeforeUnmount(() => ro?.disconnect())

const left = computed(() => start.value ?? todayN)
const days = computed(() => trackW.value / ppd.value)
const xOf = (n: number) => (n - left.value) * ppd.value
const offX = computed(() => left.value * ppd.value)

function zoomTo(next: number, anchorX = trackW.value / 2) {
    const p = Math.min(MAX_PPD, Math.max(MIN_PPD, next))
    const at = left.value + anchorX / ppd.value
    ppd.value = p
    start.value = at - anchorX / p
}
const panBy = (px: number) => (start.value = left.value + px / ppd.value)
function goToday() {
    start.value = todayN - days.value * 0.25
}
function reveal(date: string) {
    const n = dayNum(date)
    if (n < left.value + days.value * 0.05 || n > left.value + days.value * 0.95) start.value = n - days.value / 2
}
defineExpose({ reveal, goToday })

interface Tick {
    x: number
    w: number
    label: string
    key: string
    weekend?: boolean
    strong?: boolean
}
function monthStarts(fromN: number, toN: number): number[] {
    const d = fromDayNum(Math.floor(fromN))
    let [y, m] = d.split('-').map(Number)
    const out: number[] = []
    for (let i = 0; i < 400; i++) {
        const n = dayNum(`${y}-${String(m).padStart(2, '0')}-01`)
        if (n > toN) break
        out.push(n)
        m++
        if (m > 12) {
            m = 1
            y++
        }
    }
    return out
}
const axis = computed(() => {
    const a = Math.floor(left.value) - 1
    const b = Math.ceil(left.value + days.value) + 1
    const major: Tick[] = []
    const minor: Tick[] = []
    const lines: Tick[] = []
    const months = monthStarts(a - 31, b + 31)
    const p = ppd.value
    if (p >= 14) {
        for (let i = 0; i < months.length - 1; i++) {
            const d = fromDayNum(months[i])
            major.push({ x: xOf(months[i]), w: (months[i + 1] - months[i]) * p, label: `${d.slice(0, 4)}年${Number(d.slice(5, 7))}月`, key: d })
        }
        for (let n = a; n <= b; n++) {
            const wd = new Date(n * 86400000).getUTCDay()
            const d = fromDayNum(n)
            minor.push({ x: xOf(n), w: p, label: String(Number(d.slice(8))), key: d, weekend: wd === 0 || wd === 6, strong: d.endsWith('-01') })
        }
        lines.push(...minor)
    } else {
        const years = months.filter((n) => fromDayNum(n).endsWith('-01-01'))
        const ys = [months[0], ...years.filter((n) => n !== months[0])]
        for (let i = 0; i < ys.length; i++) {
            const end = ys[i + 1] ?? months[months.length - 1]
            major.push({ x: xOf(ys[i]), w: (end - ys[i]) * p, label: `${fromDayNum(ys[i]).slice(0, 4)}年`, key: `y${ys[i]}` })
        }
        const monthW = 30 * p
        for (let i = 0; i < months.length - 1; i++) {
            const d = fromDayNum(months[i])
            const mo = Number(d.slice(5, 7))
            const label = monthW >= 26 ? `${mo}月` : monthW >= 9 && (mo - 1) % 3 === 0 ? `${mo}` : ''
            minor.push({ x: xOf(months[i]), w: (months[i + 1] - months[i]) * p, label, key: d, strong: mo === 1 })
        }
        lines.push(...minor.filter((t) => monthW >= 6 || t.strong))
    }
    const majorLabels = major
        .map((t) => ({ key: t.key, label: t.label, x: Math.max(t.x, 0) + 6, room: t.x + t.w - Math.max(t.x, 0) }))
        .filter((l) => l.room > l.label.length * 12 + 8)
    return { major, minor, lines, majorLabels }
})

interface Placed {
    it: TimelineItem
    x: number
    w: number
    lane: number
    range: boolean
    color: string
}
const CHAR_W = 12.5
const layout = computed(() => {
    const p = ppd.value
    const byRow = new Map<string, Placed[]>()
    for (const r of props.rows) byRow.set(r.id, [])
    for (const it of props.items) {
        const list = byRow.get(it.row)
        if (!list) continue
        const a = dayNum(it.date)
        const range = !!it.end && it.end > it.date
        const x = range ? a * p : (a + 0.5) * p - 6
        const barW = range ? (dayNum(it.end!) + 1 - a) * p : 0
        const textW = 18 + [...it.title].length * CHAR_W
        list.push({ it, x, w: Math.max(barW, range ? 8 : textW), lane: 0, range, color: KIND_COLORS[props.kindOf(it.kind, it.dir).color] })
    }
    const heights = new Map<string, number>()
    for (const [row, list] of byRow) {
        list.sort((a, b) => a.x - b.x || b.w - a.w)
        const ends: number[] = []
        for (const pl of list) {
            let lane = ends.findIndex((e) => e <= pl.x - 4)
            if (lane === -1) lane = ends.length
            ends[lane] = pl.x + pl.w
            pl.lane = lane
        }
        heights.set(row, Math.max(1, ends.length) * LANE_H + 10 + (bandRows.value.has(row) ? BAND_H : 0))
    }
    return { byRow, heights }
})

const bandRows = computed(() => {
    const m = new Map<string, TimelineBand[]>()
    for (const b of props.bands) {
        const l = m.get(b.row)
        if (l) l.push(b)
        else m.set(b.row, [b])
    }
    for (const l of m.values()) l.sort((a, b) => a.date.localeCompare(b.date))
    return m
})
const bandsOf = (row: string) => {
    const p = ppd.value
    const edge = left.value + days.value + 2
    return (bandRows.value.get(row) ?? [])
        .map((b, i) => {
            const a = dayNum(b.date)
            const z = b.until ? dayNum(b.until) + 1 : Math.max(edge, a + 1)
            const x = xOf(a)
            return { b, x, w: (z - a) * p, odd: i % 2 === 1, on: !!props.asOf && b.date <= props.asOf && (!b.until || b.until >= props.asOf) }
        })
        .filter((v) => v.x + v.w >= -40 && v.x <= trackW.value + 40)
}
const bandTip = (b: TimelineBand) => [`${b.date} 〜 ${b.until ?? ''}`, b.title].filter(Boolean).join('\n')
const xIn = (pl: Placed) => pl.x - offX.value
const visible = (pl: Placed) => xIn(pl) + pl.w >= -40 && xIn(pl) <= trackW.value + 40
const rowHeight = (id: string) => layout.value.heights.get(id) ?? LANE_H + 10

let pan: { x: number; start: number } | null = null
function onTrackDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.item, .band')) return
    pan = { x: e.clientX, start: left.value }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
let frame = 0
let panX: number | null = null
let wheelZoom = 0
let wheelAnchor = 0
let wheelPan = 0
function applyFrame() {
    frame = 0
    if (pan && panX !== null) start.value = pan.start - (panX - pan.x) / ppd.value
    panX = null
    if (wheelZoom) zoomTo(ppd.value * Math.exp(-wheelZoom * 0.0015), wheelAnchor)
    if (wheelPan) panBy(wheelPan)
    wheelZoom = 0
    wheelPan = 0
}
const schedule = () => (frame ||= requestAnimationFrame(applyFrame))
onBeforeUnmount(() => cancelAnimationFrame(frame))
function onTrackMove(e: PointerEvent) {
    if (!pan) return
    panX = e.clientX
    schedule()
}
const onTrackUp = () => {
    if (frame) applyFrame()
    pan = null
}

function dateAt(e: MouseEvent): string {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return fromDayNum(Math.floor(left.value + (e.clientX - rect.left) / ppd.value))
}
function onTrackDbl(e: MouseEvent, row: string) {
    if ((e.target as HTMLElement).closest('.item, .band')) return
    emit('add', { date: dateAt(e), row })
}

function onWheel(e: WheelEvent) {
    const rect = scroller.value!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        wheelZoom += e.deltaY
        wheelAnchor = Math.max(0, e.clientX - rect.left - labelW.value)
        schedule()
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        wheelPan += e.shiftKey ? e.deltaY : e.deltaX
        schedule()
    }
}

const drag = ref<{ key: string; x: number; days: number; moved: boolean } | null>(null)
function onItemDown(e: PointerEvent, pl: Placed) {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.value = { key: pl.it.key, x: e.clientX, days: 0, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onItemMove(e: PointerEvent, pl: Placed) {
    const d = drag.value
    if (!d || d.key !== pl.it.key) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 4) d.moved = true
    if (pl.it.movable && d.moved) d.days = Math.round(dx / ppd.value)
}
function onItemUp(pl: Placed) {
    const d = drag.value
    drag.value = null
    if (!d || d.key !== pl.it.key) return
    if (!d.moved) emit('select', pl.it)
    else if (pl.it.movable && d.days) emit('move', pl.it, addDays(pl.it.date, d.days))
}
const shiftOf = (pl: Placed) => (drag.value?.key === pl.it.key && drag.value.days ? drag.value.days * ppd.value : 0)
const dragLabel = computed(() => {
    const d = drag.value
    if (!d?.days) return ''
    const it = props.items.find((i) => i.key === d.key)
    return it ? addDays(it.date, d.days) : ''
})

// 予定にフォーカスが移ると隠している横スクロールが動くので
function noScroll(e: Event) {
    const el = e.target as HTMLElement
    if (el.scrollLeft) el.scrollLeft = 0
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') panBy(-trackW.value / 6)
    else if (e.key === 'ArrowRight') panBy(trackW.value / 6)
    else if (e.key === '+' || e.key === '=') zoomTo(ppd.value * 1.5)
    else if (e.key === '-') zoomTo(ppd.value / 1.5)
    else return
    e.preventDefault()
}

const todayX = computed(() => xOf(todayN) + ppd.value / 2)
const asOfX = computed(() => (props.asOf ? xOf(dayNum(props.asOf)) + ppd.value / 2 : null))
const asOfLabel = computed(() => (props.asOf ? `${props.asOf.slice(0, 4)}/${Number(props.asOf.slice(5, 7))}/${Number(props.asOf.slice(8))}` : ''))
const rangeLabel = computed(() => {
    const a = fromDayNum(Math.floor(left.value))
    const b = fromDayNum(Math.floor(left.value + days.value))
    const f = (s: string) => `${s.slice(0, 4)}/${Number(s.slice(5, 7))}`
    return `${f(a)} 〜 ${f(b)}`
})
const tipOf = (it: TimelineItem) =>
    [
        `${props.kindOf(it.kind, it.dir).label}：${it.title}`,
        it.end ? `${it.date} 〜 ${it.end}` : it.date,
        it.done ? '済み' : it.overdue ? '期限切れ' : '',
        it.note ?? '',
    ]
        .filter(Boolean)
        .join('\n')
</script>

<template>
    <div class="tl">
        <div class="tools">
            <slot name="tools" />
            <span class="cd-grow" />
            <span class="cd-muted range">{{ rangeLabel }}</span>
            <UFieldGroup size="xs">
                <UButton icon="i-lucide-chevron-left" square color="neutral" variant="outline" aria-label="前へ" @click="panBy(-trackW / 2)" />
                <UButton label="今日" color="neutral" variant="outline" @click="goToday" />
                <UButton icon="i-lucide-chevron-right" square color="neutral" variant="outline" aria-label="次へ" @click="panBy(trackW / 2)" />
            </UFieldGroup>
            <SegmentSwitch v-model="scale" size="xs" :items="SCALES.map((s) => ({ value: s.value, label: s.label }))" />
            <UTooltip
                :text="`${MOD_KEY}＋ホイールで拡大・縮小します。背景のドラッグか Shift＋ホイールで、表示する期間を前後に動かします。空いた所をダブルクリックすると、その日に期日を追加します`"
            >
                <UIcon name="i-lucide-circle-help" class="help" />
            </UTooltip>
        </div>

        <div ref="scroller" class="scroller" tabindex="0" aria-label="タイムライン" @wheel="onWheel" @keydown="onKey">
            <div class="content" :style="{ '--label-w': `${labelW}px` }">
                <div class="axis" :style="{ height: `${AXIS_H}px` }">
                    <div v-if="!bare" class="corner" />
                    <div class="axis-track" @click="(e) => emit('asOf', dateAt(e))">
                        <div class="major">
                            <span v-for="t in axis.major" :key="t.key" class="tick" :style="{ left: `${t.x}px`, width: `${t.w}px` }" />
                            <span v-for="l in axis.majorLabels" :key="'l' + l.key" class="mlabel" :style="{ left: `${l.x}px` }">{{ l.label }}</span>
                        </div>
                        <div class="minor">
                            <span
                                v-for="t in axis.minor"
                                :key="t.key"
                                class="tick"
                                :class="{ weekend: t.weekend, strong: t.strong }"
                                :style="{ left: `${t.x}px`, width: `${t.w}px` }"
                                >{{ t.label }}</span
                            >
                        </div>
                        <span class="today-tag" :style="{ left: `${todayX}px` }">今日</span>
                        <span v-if="asOfX !== null" class="asof-tag" :style="{ left: `${asOfX}px` }">{{ asOfLabel }}</span>
                    </div>
                </div>

                <div class="rows">
                    <div class="bg" aria-hidden="true">
                        <span
                            v-for="t in axis.lines"
                            :key="t.key"
                            class="line"
                            :class="{ weekend: t.weekend, strong: t.strong }"
                            :style="{ left: `${t.x}px`, width: `${t.w}px` }"
                        />
                        <span class="today" :style="{ left: `${todayX}px` }" />
                        <span v-if="asOfX !== null" class="asof" :style="{ left: `${asOfX}px` }" />
                    </div>

                    <div v-for="r in rows" :key="r.id" class="row" :style="{ height: `${rowHeight(r.id)}px` }">
                        <button v-if="!bare" class="rlabel" :title="r.title ?? r.label" @click="emit('rowClick', r)">
                            <span class="rname">{{ r.label }}</span>
                            <span v-if="r.sub" class="rsub">{{ r.sub }}</span>
                        </button>
                        <div
                            class="track"
                            @scroll="noScroll"
                            @pointerdown="onTrackDown"
                            @pointermove="onTrackMove"
                            @pointerup="onTrackUp"
                            @pointercancel="onTrackUp"
                            @dblclick="(e) => onTrackDbl(e, r.id)"
                        >
                            <template v-for="pl in layout.byRow.get(r.id)" :key="pl.it.key">
                                <button
                                    v-if="visible(pl)"
                                    class="item"
                                    :class="{
                                        range: pl.range,
                                        done: pl.it.done,
                                        overdue: pl.it.overdue,
                                        on: selected === pl.it.key,
                                        movable: pl.it.movable,
                                        dragging: drag?.key === pl.it.key && drag.days,
                                        delivery: pl.it.source === 'delivery',
                                    }"
                                    :style="{
                                        left: `${xIn(pl) + shiftOf(pl)}px`,
                                        top: `${pl.lane * LANE_H + 5}px`,
                                        width: pl.range ? `${pl.w}px` : undefined,
                                        paddingLeft: pl.range && xIn(pl) < 0 ? `${6 - xIn(pl)}px` : undefined,
                                        '--k': pl.color,
                                    }"
                                    :title="tipOf(pl.it)"
                                    @pointerdown="(e) => onItemDown(e, pl)"
                                    @pointermove="(e) => onItemMove(e, pl)"
                                    @pointerup="onItemUp(pl)"
                                    @keydown.enter.prevent="emit('select', pl.it)"
                                >
                                    <span v-if="!pl.range" class="mark" />
                                    <UIcon v-if="pl.it.done" name="i-lucide-check" class="check" />
                                    <span class="name">{{ pl.it.title }}</span>
                                    <span v-if="drag?.key === pl.it.key && dragLabel" class="drag-date">{{ dragLabel }}</span>
                                </button>
                            </template>
                            <button
                                v-for="v in bandsOf(r.id)"
                                :key="v.b.key"
                                class="band"
                                :class="{ odd: v.odd, on: v.on, open: !v.b.until }"
                                :style="{ left: `${v.x}px`, width: `${v.w}px` }"
                                :title="bandTip(v.b)"
                                :aria-label="bandTip(v.b)"
                                @click="emit('band', v.b)"
                            />
                        </div>
                    </div>
                    <div v-if="!rows.length" class="empty cd-muted">表示するものがありません</div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.tl {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}

.tools {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--ui-border);
    flex-wrap: wrap;
}

.range {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
}

.help {
    width: 16px;
    height: 16px;
    color: var(--ui-text-dimmed);
}

.scroller {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    outline: none;
}

.content {
    position: relative;
    min-height: 100%;
}

.axis {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    background: var(--ui-bg);
    border-bottom: 1px solid var(--ui-border);
}

.corner {
    flex: 0 0 var(--label-w);
    border-right: 1px solid var(--ui-border);
    background: var(--ui-bg);
    position: relative;
    z-index: 1;
}

.axis-track {
    position: relative;
    flex: 1;
    overflow: hidden;
}

.major,
.minor {
    position: relative;
    height: 22px;
}

.major {
    border-bottom: 1px solid var(--ui-border);
}

.tick {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    font-size: 11px;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    border-left: 1px solid var(--ui-border);
}

.major .tick {
    font-weight: 600;
    color: var(--ui-text-toned);
}

.mlabel {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-toned);
    white-space: nowrap;
    pointer-events: none;
}

.minor .tick {
    justify-content: center;
    font-variant-numeric: tabular-nums;
    border-left-color: color-mix(in oklab, var(--ui-border) 60%, transparent);
}

.minor .tick.strong {
    border-left-color: var(--ui-border-accented);
}

.minor .tick.weekend {
    color: var(--ui-text-dimmed);
}

.today-tag {
    position: absolute;
    bottom: 1px;
    transform: translateX(-50%);
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    color: white;
    background: var(--ui-color-error-500);
    pointer-events: none;
}

.asof-tag {
    position: absolute;
    top: 1px;
    transform: translateX(-50%);
    padding: 0 4px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: white;
    background: var(--ui-color-primary-500);
    pointer-events: none;
}

.axis-track {
    cursor: pointer;
}

.asof {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--ui-color-primary-500);
}

.band {
    position: absolute;
    bottom: 4px;
    height: 8px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--ui-color-primary-500) 35%, var(--ui-bg));
    border-left: 2px solid var(--ui-color-primary-500);
    cursor: pointer;
}

.band.odd {
    background: color-mix(in oklab, var(--ui-color-primary-500) 20%, var(--ui-bg));
}

.band.open {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
}

.band:hover,
.band.on {
    background: color-mix(in oklab, var(--ui-color-primary-500) 60%, var(--ui-bg));
}

.rows {
    position: relative;
}

.bg {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--label-w);
    right: 0;
    overflow: hidden;
    pointer-events: none;
}

.line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid color-mix(in oklab, var(--ui-border) 55%, transparent);
}

.line.strong {
    border-left-color: var(--ui-border);
}

.line.weekend {
    background: color-mix(in oklab, var(--ui-bg-elevated) 70%, transparent);
}

.today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 2px solid var(--ui-color-error-500);
    opacity: 0.7;
}

.row {
    display: flex;
    border-bottom: 1px solid var(--ui-border);
}

.rlabel {
    position: relative;
    z-index: 2;
    flex: 0 0 var(--label-w);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 0 12px;
    text-align: left;
    background: var(--ui-bg);
    border-right: 1px solid var(--ui-border);
    cursor: pointer;
    min-width: 0;
}

.rlabel:hover .rname {
    color: var(--ui-color-primary-500);
}

.rname,
.rsub {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.rname {
    font-size: 13px;
    font-weight: 600;
}

.rsub {
    font-size: 11px;
    color: var(--ui-text-muted);
}

.track {
    position: relative;
    flex: 1;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
}

.track:active {
    cursor: grabbing;
}

.item {
    position: absolute;
    height: 20px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px 0 0;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    color: var(--ui-text);
}

.item:hover,
.item:focus-visible {
    background: color-mix(in oklab, var(--k) 12%, transparent);
    outline: none;
}

.item.movable {
    cursor: ew-resize;
}

.mark {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    margin-left: 1px;
    transform: rotate(45deg);
    border-radius: 2px;
    background: var(--k);
}

.delivery .mark {
    transform: none;
    border-radius: 50%;
}

.item.range {
    padding: 0 6px;
    overflow: hidden;
    background: color-mix(in oklab, var(--k) 20%, var(--ui-bg));
    border-left: 3px solid var(--k);
}

.item.range:hover {
    background: color-mix(in oklab, var(--k) 30%, var(--ui-bg));
}

.name {
    overflow: hidden;
    text-overflow: ellipsis;
}

.check {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    color: var(--ui-color-success-500);
}

.item.done {
    opacity: 0.55;
}

.item.done .name {
    text-decoration: line-through;
}

.item.overdue .name {
    color: var(--ui-color-error-500);
    font-weight: 700;
}

.item.overdue .mark {
    box-shadow:
        0 0 0 2px var(--ui-bg),
        0 0 0 3.5px var(--ui-color-error-500);
}

.item.on {
    outline: 2px solid var(--ui-color-primary-500);
    outline-offset: 1px;
    z-index: 1;
}

.item.dragging {
    z-index: 2;
    opacity: 0.85;
}

.drag-date {
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
    color: white;
    background: var(--ui-color-primary-500);
}

.empty {
    padding: 24px;
    text-align: center;
}
</style>
