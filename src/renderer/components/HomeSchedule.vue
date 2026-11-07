<script setup lang="ts">
import { addDays } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { useSchedule } from '~/composables/useSchedule'
import { baseName } from '~/utils/folders'
import { fmtDate } from '~/utils/format'

const app = useApp()
const s = useSchedule()
const LIMIT = 8

const titleOf = (path: string) =>
    !path ? 'リポジトリ全体' : (app.docs.find((d) => d.path === path)?.title ?? baseName(path).replace(/\.md$/i, ''))
const exists = (path: string) => !!path && app.docs.some((d) => d.path === path)

const upcoming = computed(() => {
    const until = addDays(s.today, 60)
    return s.items.value.filter(
        (o) => o.source !== 'delivery' && (o.overdue || (!o.done && (o.end ?? o.date) >= s.today && o.date <= until)),
    )
})
const overdueCount = computed(() => upcoming.value.filter((o) => o.overdue).length)
const deliveries = computed(() => s.items.value.filter((o) => o.source === 'delivery').slice(-3).reverse())
const thisYear = s.today.slice(0, 4)
const shortDate = (d: string) => fmtDate(`${d}T00:00:00`, d.startsWith(thisYear) ? 'md' : 'ymd')
</script>

<template>
    <section class="cd-side-sec">
        <SectionHead label="期日" icon="i-lucide-calendar-clock" :count="upcoming.length">
            <UTooltip text="期日を足す">
                <UButton icon="i-lucide-calendar-plus" size="xs" square color="neutral" variant="ghost"
                    aria-label="期日を足す" @click="app.dialog = { kind: 'newEvent', docPath: '' }" />
            </UTooltip>
            <UTooltip text="タイムラインで見る">
                <UButton icon="i-lucide-calendar-range" size="xs" square color="neutral" variant="ghost"
                    aria-label="タイムラインで見る" @click="app.openSchedule()" />
            </UTooltip>
        </SectionHead>
        <p v-if="overdueCount" class="over">
            <UIcon name="i-lucide-alarm-clock-off" />期限切れが {{ overdueCount }} 件あります
        </p>
        <p v-if="!s.loaded.value" class="cd-muted">読み込み中…</p>
        <p v-else-if="!upcoming.length" class="cd-muted">
            これから 60 日の期日はありません。施行・公布・提出・届出・契約の更新などの日付を足すと、ここに出ます。
        </p>
        <div v-else class="rows">
            <OccurrenceRow v-for="o in upcoming.slice(0, LIMIT)" :key="o.key" :o="o" :kind="s.kindOf.value(o.kind)"
                :where="titleOf(o.docPath)" @click="app.openSchedule()" @toggle="s.toggleDone(o)" />
        </div>
        <button v-if="upcoming.length > LIMIT" class="more" @click="app.openSchedule()">ほか {{ upcoming.length - LIMIT }}
            件をタイムラインで見る</button>

        <template v-if="deliveries.length">
            <SectionHead label="最近の納品" icon="i-lucide-package-check" class="sub" />
            <ul class="deliv">
                <li v-for="d in deliveries" :key="d.key">
                    <span class="cd-muted when">{{ shortDate(d.date) }}</span>
                    <button v-if="exists(d.docPath)" class="name" :title="d.title"
                        @click="app.openDoc(d.docPath, 'releases')">{{ d.title }}</button>
                    <span v-else class="name">{{ d.title }}</span>
                </li>
            </ul>
        </template>
    </section>
</template>

<style scoped>
.rows {
    margin: 0 -12px;
}

.over {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-color-error-500);
}

.more {
    margin-top: 2px;
    font-size: 12px;
    color: var(--ui-color-primary-500);
    cursor: pointer;
}

.more:hover {
    text-decoration: underline;
}

.sub {
    margin-top: 8px;
}

.deliv {
    list-style: none;
    margin: 0;
    padding: 0;
}

.deliv li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
    font-size: 12px;
    min-width: 0;
}

.when {
    flex-shrink: 0;
    min-width: 36px;
    font-variant-numeric: tabular-nums;
}

.name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: left;
}

button.name {
    cursor: pointer;
}

button.name:hover {
    color: var(--ui-color-primary-500);
}
</style>
