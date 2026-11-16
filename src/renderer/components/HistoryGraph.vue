<script setup lang="ts">
import type { CommitInfo, SigInfo } from '@shared/api'
import { layoutGraph } from '~/utils/graph'
import { firstLine, relTime } from '~/utils/format'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()

const props = defineProps<{
    commits: CommitInfo[]
    selected: string | null
    pending?: boolean
    currentLabel?: string
    pickWork?: boolean
    sigs?: Record<string, SigInfo>
}>()

const SIG_ICON = { verified: 'i-lucide-shield-check', 'unknown-key': 'i-lucide-shield-question', bad: 'i-lucide-shield-alert', pgp: 'i-lucide-shield' } as const
function sigOf(oid: string) {
    const s = props.sigs?.[oid]
    if (!s || s.state === 'none') return null
    const h = t.value.signing.history
    const who = s.signer ? (s.signer.source === 'own' ? h.own : (s.signer.login ?? s.signer.name ?? h.repo)) : ''
    const title = s.state === 'verified' ? h.verified(who) : s.state === 'unknown-key' ? h.unknownKey : s.state === 'bad' ? h.bad : h.pgp
    return { icon: SIG_ICON[s.state], cls: `sig ${s.state}`, title }
}
const emit = defineEmits<{ select: [string] }>()

const ROW = 58
const LANE = 18
const PAD = 14
const WORK = '__work'
const LANE_COLORS = ['var(--ui-color-primary-500)', 'var(--cd-draft)', '#2fa37a', '#9a6bd8', '#d4577e', '#2a9fbf']
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]

const rows = computed<(CommitInfo & { work?: boolean })[]>(() => {
    const head = props.commits.find((c) => c.head)
    if (!props.pending || !head) return props.commits
    return [
        {
            oid: WORK,
            parents: [head.oid],
            message: t.value.history.graph.unsaved,
            author: '',
            timestamp: 0,
            tags: [],
            branches: [],
            onCurrent: true,
            onMain: head.onMain,
            work: true,
        },
        ...props.commits,
    ]
})

const layout = computed(() => layoutGraph(rows.value))
const graphWidth = computed(() => layout.value.width * LANE + PAD)
const x = (lane: number) => lane * LANE + LANE / 2 + 6
const y = (row: number) => row * ROW + ROW / 2

const paths = computed(() =>
    layout.value.edges.map((e) => {
        const x1 = x(e.fromLane),
            y1 = y(e.fromRow),
            x2 = x(e.toLane),
            y2 = y(e.toRow)
        let d: string
        if (x1 === x2) d = `M${x1} ${y1}L${x2} ${y2}`
        else if (e.curve === 'top') d = `M${x1} ${y1}C${x1} ${y1 + ROW * 0.6},${x2} ${y1 + ROW * 0.4},${x2} ${y1 + ROW}L${x2} ${y2}`
        else d = `M${x1} ${y1}L${x1} ${y2 - ROW}C${x1} ${y2 - ROW * 0.4},${x2} ${y2 - ROW * 0.6},${x2} ${y2}`
        const from = rows.value[e.fromRow]
        const to = rows.value[e.toRow]
        const strong = !!from.onCurrent && !!to.onCurrent && e.curve === 'bottom'
        const lane = e.curve === 'top' ? e.toLane : e.fromLane
        return { d, color: laneColor(lane), strong, work: !!from.work }
    }),
)

const effective = (m: string) => /施行日: (\S+)/.exec(m)?.[1]
const initial = (name: string) => name.slice(0, 1)

interface Chip {
    label: string
    cls: string
    title?: string
}
function chipsOf(c: CommitInfo): Chip[] {
    const g = t.value.history.graph
    // 枝の名前は main プロセスが付けた表示名。現行版の表示名は mainBranch から取る
    const main = app.mainBranch?.label ?? '現行版'
    const out: Chip[] = []
    const names = [...c.branches].sort((a, b) => (a === main ? -1 : b === main ? 1 : 0))
    if (names.length) {
        out.push({ label: names[0], cls: names[0] === main ? 'branch main' : 'branch', title: names.join('\n') })
        if (names.length > 1) out.push({ label: `+${names.length - 1}`, cls: 'branch more', title: names.slice(1).join('\n') })
    }
    const dates = [...new Set(c.tags.filter((t) => t.startsWith('施行/')).map((t) => t.replace(/^施行\/.*\/([^/]+)$/, '$1')))]
    if (!dates.length && effective(c.message)) dates.push(effective(c.message)!)
    if (dates.length) out.push({ label: g.effective(dates[0]), cls: 'tag', title: dates.map((d) => g.effective(d)).join('\n') })
    const deliveries = c.tags.filter((t) => t.startsWith('納品/')).length
    if (deliveries) out.push({ label: g.delivered(deliveries), cls: 'tag', title: g.deliveredTitle(deliveries) })
    return out
}
</script>

<template>
    <div class="graph" :style="{ height: rows.length * ROW + 'px' }">
        <svg :width="graphWidth" :height="rows.length * ROW" class="svg">
            <path
                v-for="(p, i) in paths"
                :key="i"
                :d="p.d"
                fill="none"
                :style="{ stroke: p.color, strokeWidth: p.strong ? 2.6 : 1.6, opacity: p.strong ? 1 : 0.4, strokeDasharray: p.work ? '4 3' : undefined }"
            />
            <g v-for="(c, r) in rows" :key="c.oid">
                <circle
                    v-if="c.head"
                    :cx="x(layout.lanes[r])"
                    :cy="y(r)"
                    r="9"
                    fill="none"
                    :style="{ stroke: laneColor(layout.lanes[r]), opacity: 0.35 }"
                    stroke-width="3"
                />
                <circle
                    :cx="x(layout.lanes[r])"
                    :cy="y(r)"
                    :r="c.work ? 5 : c.parents.length > 1 ? 4.5 : 5.5"
                    :style="{
                        fill: c.work || c.parents.length > 1 ? 'var(--ui-bg)' : laneColor(layout.lanes[r]),
                        stroke: laneColor(layout.lanes[r]),
                        strokeDasharray: c.work ? '2 2' : undefined,
                        opacity: c.onCurrent || c.work ? 1 : 0.55,
                    }"
                    stroke-width="2"
                />
            </g>
        </svg>
        <div
            v-for="c in rows"
            :key="c.oid"
            class="row"
            :class="{ on: c.work ? selected === 'work' : c.oid === selected, dim: !c.onCurrent && !c.work, work: c.work && !pickWork }"
            :style="{ height: ROW + 'px', paddingLeft: graphWidth + 8 + 'px' }"
            @click="c.work ? pickWork && emit('select', 'work') : emit('select', c.oid)"
        >
            <div class="msg">
                <span class="text">{{ firstLine(c.message) }}</span>
                <span v-if="c.head" class="here">{{ t.history.graph.youAreHere }}</span>
            </div>
            <div class="meta">
                <template v-if="c.work">{{ currentLabel ? t.history.graph.editingIn(currentLabel) : t.history.graph.editing }}</template>
                <template v-else>
                    <span class="avatar">{{ initial(c.author) }}</span>{{ c.author }}
                    <UIcon
                        v-if="sigOf(c.oid)"
                        :name="sigOf(c.oid)!.icon"
                        :class="sigOf(c.oid)!.cls"
                        :title="sigOf(c.oid)!.title"
                        :aria-label="sigOf(c.oid)!.title"
                    />
                    {{ t.history.graph.sep }}{{ relTime(c.timestamp) }}
                </template>
                <span v-for="(ch, k) in chipsOf(c)" :key="k" :class="ch.cls" :title="ch.title">{{ ch.label }}</span>
            </div>
        </div>
    </div>
</template>

<style scoped>
.sig {
    width: 13px;
    height: 13px;
    margin: 0 2px;
    vertical-align: -2px;
    color: var(--ui-text-muted);
}
.sig.verified {
    color: var(--ui-success);
}
.sig.bad {
    color: var(--ui-error);
}
.graph {
    position: relative;
}

.svg {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
}

.row {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
    border-bottom: 1px solid var(--ui-border);
    padding-right: 12px;
    transition: background-color 0.12s;
}

.row:hover {
    background: var(--ui-bg-elevated);
}

.row.on {
    background: var(--cd-selected);
}

.row.dim .msg .text {
    color: var(--ui-text-muted);
}

.row.work {
    cursor: default;
}

.row.work .msg .text {
    color: var(--cd-draft);
    font-style: italic;
}

.msg {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    min-width: 0;
}

.text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-highlighted);
}

.here {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 7px;
    border-radius: 9px;
    color: #fff;
    background: var(--ui-color-primary-500);
    flex-shrink: 0;
}

.meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    min-width: 0;
}

.meta > * {
    flex-shrink: 0;
}

.branch {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.branch.more {
    color: var(--ui-text-muted);
    background: var(--ui-bg-elevated);
    border-color: var(--ui-border);
}

.avatar {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 9px;
    background: var(--ui-bg-accented);
    color: var(--ui-text-toned);
    margin-right: -2px;
}

.branch {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 4px;
    color: var(--cd-draft);
    background: var(--cd-draft-bg);
    border: 1px solid var(--cd-draft-border);
}

.branch.main {
    color: var(--ui-color-primary-600);
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
    border-color: color-mix(in oklab, var(--ui-color-primary-500) 30%, transparent);
}

.dark .branch.main {
    color: var(--ui-color-primary-300);
}

.tag {
    font-size: 10px;
    padding: 0 6px;
    border-radius: 9px;
    background: color-mix(in oklab, var(--ui-color-success-500) 14%, transparent);
    color: var(--ui-color-success-600);
}

.dark .tag {
    color: var(--ui-color-success-400);
}
</style>
