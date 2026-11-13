<script setup lang="ts">
import type { CommitInfo, EffectiveVersion } from '@shared/api'
import type { ArticleTrail } from '@shared/article-history'
import { TRAIL_KIND } from '~/composables/useArticleTrail'
import { firstLine, fmtDate, fmtWareki } from '~/utils/format'

const props = defineProps<{
    label: string
    versions: EffectiveVersion[]
    trail: ArticleTrail
    commits: CommitInfo[]
    commitTrail: ArticleTrail | null
    loading: boolean
}>()
const emit = defineEmits<{ version: [EffectiveVersion]; commit: [CommitInfo] }>()

const effective = computed(() =>
    [...props.trail.events].reverse().flatMap((e) => {
        const v = props.versions[e.step]
        return v ? [{ e, v }] : []
    }),
)
const saved = computed(() =>
    [...(props.commitTrail?.events ?? [])].reverse().flatMap((e) => {
        const c = props.commits[e.step]
        return c ? [{ e, c }] : []
    }),
)
</script>

<template>
    <div class="trail">
        <div class="head">{{ label }}の沿革</div>
        <p v-if="trail.pending" class="pending">
            <UIcon name="i-lucide-pencil-line" />未施行の変更あり
        </p>

        <div class="group">施行版</div>
        <button v-for="{ e, v } in effective" :key="v.tag" class="row" @click="emit('version', v)">
            <span class="when">{{ fmtWareki(v.date) }}施行</span>
            <span class="kind" :class="e.kind">{{ TRAIL_KIND[e.kind] }}</span>
            <span class="msg">{{ firstLine(v.message) }}</span>
        </button>
        <p v-if="!effective.length" class="none">ありません</p>

        <div class="group">保存した版</div>
        <p v-if="loading" class="none">
            <UIcon name="i-lucide-loader-circle" class="spin" />読み込み中
        </p>
        <template v-else>
            <button v-for="{ e, c } in saved" :key="c.oid" class="row" @click="emit('commit', c)">
                <span class="when">{{ fmtDate(c.timestamp, 'ymd') }}</span>
                <span class="kind" :class="e.kind">{{ TRAIL_KIND[e.kind] }}</span>
                <span class="msg">{{ firstLine(c.message) }}</span>
                <span class="who">{{ c.author }}</span>
            </button>
            <p v-if="!saved.length" class="none">ありません</p>
        </template>
    </div>
</template>

<style scoped>
.trail {
    width: 420px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 6px 0;
    font-size: 12px;
}

.head {
    padding: 4px 12px 6px;
    font-weight: 700;
    font-size: 13px;
}

.pending {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 12px 4px;
    color: var(--cd-draft);
}

.group {
    padding: 8px 12px 2px;
    font-size: 11px;
    font-weight: 700;
    color: var(--ui-text-muted);
}

.row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 4px 12px;
    text-align: left;
    cursor: pointer;
}

.row:hover {
    background: var(--ui-bg-elevated);
}

.when {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}

.kind {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 11px;
    background: var(--ui-bg-accented);
}

.kind.changed {
    color: var(--ui-color-primary-600);
}

.kind.added {
    color: var(--ui-color-success-600);
}

.msg {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ui-text-toned);
}

.who {
    flex-shrink: 0;
    color: var(--ui-text-muted);
}

.none {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 4px 12px;
    color: var(--ui-text-muted);
}

.spin {
    animation: cd-spin 0.9s linear infinite;
}

@keyframes cd-spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
