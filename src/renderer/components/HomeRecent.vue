<script setup lang="ts">
import type { RepoActivity } from '@shared/api'
import { useApp } from '~/stores/app'
import { baseName } from '~/utils/folders'
import { firstLine, fmtDate } from '~/utils/format'

const props = defineProps<{ activity: RepoActivity | null }>()
const app = useApp()
const FIRST = 6
const all = ref(false)

const titleOf = (path: string) => app.docs.find((d) => d.path === path)?.title ?? baseName(path).replace(/\.md$/i, '')
const exists = (path: string) => app.docs.some((d) => d.path === path)

const dayKey = (ts: number) => {
    const d = new Date(ts * 1000)
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function dayLabel(ts: number) {
    const k = dayKey(ts)
    const now = Date.now() / 1000
    if (k === dayKey(now)) return '今日'
    if (k === dayKey(now - 86400)) return '昨日'
    return fmtDate(ts, new Date(ts * 1000).getFullYear() === new Date().getFullYear() ? 'md' : 'ymd')
}
const hm = (ts: number) => fmtDate(ts, 'mdhm').split(' ')[1]

const days = computed(() => {
    const list = (props.activity?.recent ?? []).slice(0, all.value ? undefined : FIRST)
    const out: { label: string; items: typeof list }[] = []
    for (const r of list) {
        const label = dayLabel(r.timestamp)
        if (out.at(-1)?.label === label) out.at(-1)!.items.push(r)
        else out.push({ label, items: [r] })
    }
    return out
})

function openAt(path: string, oid: string) {
    app.historySelect = oid
    app.openDoc(path, 'history')
}
</script>

<template>
    <section class="cd-side-sec">
        <SectionHead label="最近の更新" icon="i-lucide-history">
            <span class="sub" :title="'作業中：' + (app.currentBranch?.label ?? '')">{{ app.currentBranch?.label }}</span>
        </SectionHead>
        <p v-if="!activity" class="cd-muted empty">読み込み中…</p>
        <p v-else-if="!activity.recent.length" class="cd-muted empty">まだ版がありません。版を保存すると、ここに並びます。</p>
        <template v-else>
            <div v-for="g in days" :key="g.label" class="day">
                <div class="day-label">{{ g.label }}</div>
                <ol class="feed">
                    <li v-for="r in g.items" :key="r.oid">
                        <div class="msg">
                            <IssueText :text="firstLine(r.message)" />
                        </div>
                        <div class="cd-muted meta">
                            {{ r.author }}・<span :title="fmtDate(r.timestamp, 'ymdhm')">{{ hm(r.timestamp) }}</span>
                        </div>
                        <div v-if="r.paths.length" class="docs">
                            <template v-for="p in r.paths.slice(0, 4)" :key="p">
                                <button v-if="exists(p)" class="cd-chip" :title="`${p} の改定履歴を開く`"
                                    @click="openAt(p, r.oid)">{{ titleOf(p) }}</button>
                                <span v-else class="cd-chip gone" :title="`${p}（今はありません）`">{{ titleOf(p) }}</span>
                            </template>
                            <span v-if="r.paths.length > 4" class="cd-muted more">ほか {{ r.paths.length - 4 }}</span>
                        </div>
                    </li>
                </ol>
            </div>
            <button v-if="activity.recent.length > FIRST" class="toggle" @click="all = !all">
                {{ all ? '少なく表示' : `もっと見る（${activity.recent.length - FIRST}）` }}
            </button>
        </template>
    </section>
</template>

<style scoped>
.sub {
    font-weight: 400;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.empty {
    font-size: 12px;
    margin: 0;
}

.day+.day {
    margin-top: 8px;
}

.day-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-muted);
    margin-bottom: 4px;
}

.feed {
    list-style: none;
    margin: 0 0 0 4px;
    padding: 0 0 0 14px;
    border-left: 1px solid var(--ui-border-accented);
}

.feed li {
    position: relative;
    padding: 0 0 10px;
}

.feed li::before {
    content: '';
    position: absolute;
    left: -18px;
    top: 6px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ui-bg);
    border: 2px solid var(--ui-color-primary-500);
}

.msg {
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.meta {
    font-size: 11px;
    margin: 1px 0 3px;
}

.docs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}

.more {
    font-size: 11px;
}

.toggle {
    font-size: 12px;
    color: var(--ui-color-primary-500);
    cursor: pointer;
}
</style>
