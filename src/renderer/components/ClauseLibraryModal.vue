<script setup lang="ts">
import { applyClause, defaultChoice, extractClauses, targetArticles, type Clause, type ClauseInsert, type RefChoice } from '@shared/clauses'
import type { LegalDoc } from '@shared/legal-parser'
import { articleTitle, parseLegal } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { withImages } from '~/utils/images'

const props = defineProps<{ libraryDir: string; libraryName: string; target: LegalDoc; targetText: string }>()
const emit = defineEmits<{ close: []; insert: [ClauseInsert] }>()

const clauses = ref<Clause[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const selected = ref<Clause | null>(null)
const step = ref<'pick' | 'map'>('pick')
const choices = ref<Record<string, string>>({})

onMounted(async () => {
    try {
        const docs = await window.api.listDocs(props.libraryDir)
        const out: Clause[] = []
        for (const d of docs) {
            const src = await window.api.readDoc(props.libraryDir, d.path).catch(() => null)
            if (typeof src === 'string') out.push(...extractClauses(src, d.path, d.title))
        }
        clauses.value = out
        selected.value = out[0] ?? null
    } catch (e) {
        error.value = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    } finally {
        loading.value = false
    }
})

const norm = (s: string) => s.normalize('NFKC').toLowerCase()
const filtered = computed(() => {
    const q = norm(query.value.trim())
    return q ? clauses.value.filter((c) => norm(`${c.title} ${c.docTitle} ${c.body}`).includes(q)) : clauses.value
})
const groups = computed(() => {
    const m = new Map<string, Clause[]>()
    for (const c of filtered.value) m.set(c.docTitle, [...(m.get(c.docTitle) ?? []), c])
    return [...m.entries()]
})
const preview = computed(() => (selected.value ? withImages(renderDoc(parseLegal(selected.value.body)), props.libraryDir, selected.value.docPath) : ''))

const encode = (c: RefChoice) => (c.kind === 'article' ? `a:${c.index}` : c.kind)
const decode = (v: string): RefChoice => (v.startsWith('a:') ? { kind: 'article', index: Number(v.slice(2)) } : { kind: v as 'text' | 'keep' })
const choiceItems = computed(() => [
    ...targetArticles(props.target).map((a, i) => ({ label: a.title ? `${a.label}（${articleTitle(a, props.target)}）` : a.label, value: `a:${i}` })),
    { label: '参照を外して見出しの文字で残す', value: 'text' },
    { label: 'そのまま残す（参照切れになります）', value: 'keep' },
])

function next() {
    const c = selected.value
    if (!c) return
    if (!c.refs.length) return finish()
    choices.value = Object.fromEntries(c.refs.map((r) => [r.id, encode(defaultChoice(r, props.target))]))
    step.value = 'map'
}

function finish() {
    const c = selected.value
    if (!c) return
    const picked = Object.fromEntries(Object.entries(choices.value).map(([k, v]) => [k, decode(v)]))
    emit('insert', applyClause(c, props.target, props.targetText.replace(/\r\n/g, '\n').split('\n'), picked))
}
</script>

<template>
    <UModal
        :open="true"
        :title="step === 'pick' ? '条項ライブラリから入れる' : '条参照の対応づけ'"
        :description="
            step === 'pick'
                ? `ライブラリ「${libraryName}」の条を選びます。カーソルのある条の後に入ります。`
                : `「${selected?.title}」には、ほかの条への参照があります。入れる先の文書のどの条を指すかを選んでください。`
        "
        :ui="{ content: 'cd-wide' }"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <div v-if="step === 'pick'" class="pick">
                <div class="list">
                    <UInput v-model="query" icon="i-lucide-search" placeholder="見出し・本文で探す" class="w-full" autofocus />
                    <p v-if="loading" class="cd-muted">読み込んでいます…</p>
                    <p v-else-if="error" class="err">{{ error }}</p>
                    <p v-else-if="!clauses.length" class="cd-muted">ライブラリに条がありません。ライブラリのリポジトリに、条を書いた文書を作ってください。</p>
                    <p v-else-if="!filtered.length" class="cd-muted">合う条がありません。</p>
                    <div v-for="[title, list] in groups" :key="title" class="group">
                        <p class="group-head">{{ title }}</p>
                        <button v-for="c in list" :key="c.key" class="item" :class="{ on: selected?.key === c.key }" @click="selected = c" @dblclick="next">
                            <span class="nm">{{ c.title || c.label }}</span>
                            <UBadge v-if="c.refs.length" :label="`参照 ${c.refs.length}`" size="sm" color="neutral" variant="subtle" />
                        </button>
                    </div>
                </div>
                <div class="preview cd-canvas">
                    <div v-if="selected" class="paper cd-paper" v-html="preview" />
                </div>
            </div>
            <div v-else class="cd-form">
                <div v-for="r in selected?.refs ?? []" :key="r.id" class="map-row">
                    <div class="from">
                        <code>[[{{ r.id }}]]</code>
                        <span class="cd-muted">{{ r.title ? `（${r.title}）` : '（ライブラリに見つからない条）' }}</span>
                    </div>
                    <UIcon name="i-lucide-arrow-right" class="arrow" />
                    <USelect v-model="choices[r.id]" :items="choiceItems" class="to" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton v-if="step === 'map'" label="戻る" color="neutral" variant="ghost" @click="step = 'pick'" />
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton v-if="step === 'pick'" :label="selected?.refs.length ? '次へ' : '挿入する'" :disabled="!selected" @click="next" />
                <UButton v-else label="挿入する" @click="finish" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.pick {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 16px;
    height: min(60vh, 560px);
}

.list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    padding-right: 4px;
}

.group-head {
    margin: 8px 0 2px;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
}

.item:hover {
    background: var(--ui-bg-elevated);
}

.item.on {
    background: var(--cd-selected);
    color: var(--ui-primary);
}

.item .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preview {
    overflow-y: auto;
    border-radius: 8px;
    padding: 16px;
}

.preview .paper {
    padding: 24px 32px;
}

.err {
    color: var(--ui-error);
}

.map-row {
    display: grid;
    grid-template-columns: 1fr auto 1.2fr;
    align-items: center;
    gap: 12px;
}

.from {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.arrow {
    color: var(--ui-text-muted);
}
</style>
