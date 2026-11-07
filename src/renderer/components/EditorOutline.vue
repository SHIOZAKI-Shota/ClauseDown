<script setup lang="ts">
import type { LegalDoc } from '@shared/legal-parser'
import { chapterHeading } from '@shared/legal-parser'
import { lastAtOrBefore } from '~/utils/legal-editor'
const props = defineProps<{ legal: LegalDoc; line: number }>()
const emit = defineEmits<{ jump: [number] }>()
const q = ref('')

interface Entry {
    key: string
    line: number
    label: string
    title: string
    kind: 'chapter' | 'article'
    deleted?: boolean
}

const entries = computed<Entry[]>(() => {
    const out: Entry[] = []
    let n = 0
    props.legal.chapters.forEach((ch, ci) => {
        if (ch.kind === 'closing') return
        const head = chapterHeading(ch)
        if (head && ch.line >= 0) out.push({ key: `c${ci}`, line: ch.line, label: ch.label || head, title: ch.label ? ch.title : '', kind: 'chapter' })
        for (const a of ch.articles) out.push({ key: `a${n++}`, line: a.line, label: a.label, title: a.title, kind: 'article', deleted: a.deleted })
    })
    return out
})
const articleLines = computed(() => entries.value.filter((e) => e.kind === 'article').map((e) => e.line))

const filtered = computed(() => {
    const w = q.value.trim()
    return w ? entries.value.filter((e) => `${e.label}${e.title}`.includes(w)) : entries.value
})

const active = computed(() => {
    const i = lastAtOrBefore(articleLines.value, props.line)
    return i < 0 ? -1 : articleLines.value[i]
})

const list = ref<HTMLElement>()
watch(active, async () => {
    await nextTick()
    list.value?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
    <aside class="ed-outline">
        <div class="cd-pane-bar">
            <span class="cd-pane-title">目次 <span class="count">{{ articleLines.length }}
                    条</span></span>
        </div>
        <UInput v-model="q" icon="i-lucide-search" size="xs" placeholder="条を探す" class="search" />
        <div ref="list" class="list">
            <button v-for="e in filtered" :key="e.key"
                :class="[e.kind, { on: e.line === active, deleted: e.deleted }]" @click="emit('jump', e.line)">
                <span class="label">{{ e.label }}</span>
                <span class="title">{{ e.deleted ? '削除' : e.title }}</span>
            </button>
            <p v-if="!filtered.length" class="empty">{{ q ? '見つかりません' : '条がありません' }}</p>
        </div>
    </aside>
</template>

<style scoped>
.ed-outline {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    border-right: 1px solid var(--ui-border);
    background: var(--cd-sidebar);
}

.count {
    font-weight: 400;
    margin-left: 4px;
}

.ed-outline .cd-pane-bar {
    background: transparent;
    border-bottom: none;
}

.search {
    margin: 2px 8px 6px;
}

.list {
    flex: 1;
    overflow: auto;
    padding: 0 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

button {
    display: flex;
    gap: 6px;
    align-items: baseline;
    text-align: left;
    width: 100%;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--ui-text-toned);
    cursor: pointer;
}

button:hover {
    background: var(--ui-bg-accented);
}

button.chapter {
    margin-top: 8px;
    font-weight: 700;
    color: var(--cd-syn-chapter);
}

button.article .label {
    color: var(--cd-syn-article);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}

button.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
}

button.deleted .title {
    color: var(--ui-text-dimmed);
}

.title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    font-size: 12px;
    color: var(--ui-text-muted);
    padding: 8px;
    margin: 0;
}
</style>
