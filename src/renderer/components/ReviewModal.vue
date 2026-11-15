<script setup lang="ts">
import type { ReviewAction } from '@shared/api'
import { compareSources } from '@shared/article-diff'
import { renderCompareTable } from '@shared/legal-renderer'
import { docLang } from '@shared/legal-parser'
import { compareWords } from '@shared/legal-styles'
import { canApprove, prOf, STATE_COLOR, STATE_LABEL } from '@shared/review'
import { FORGE_LABEL, reviewRefLabel } from '@shared/forge'
import { useApp } from '~/stores/app'
import { fmtDate } from '~/utils/format'
import { useT } from '~/composables/useT'

const props = defineProps<{ branch: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()

const b = computed(() => app.branches.find((x) => x.name === props.branch))
const status = computed(() => (b.value ? app.statusOf(b.value) : null))
const open = computed(() => !!status.value?.request)
const text = ref('')
const files = ref<string[]>([])
const file = ref('')
const rendered = ref<{ html: string; lang: ReturnType<typeof docLang> } | null>(null)
// 表の見出しは文書の言語の「改正後／改正前」で出るので、画面の言語の「改定案／現行版」に置き換える
const table = computed(() => {
    const r = rendered.value
    if (!r) return ''
    const w = compareWords(r.lang)
    return r.html.replace(`<th>${w.revised}</th><th>${w.current}</th>`, `<th>${t.value.review.headDraft}</th><th>${t.value.review.headCurrent}</th>`)
})

const ACTION_ICON: Record<ReviewAction, string> = {
    request: 'i-lucide-send',
    approve: 'i-lucide-badge-check',
    changes: 'i-lucide-pencil-line',
    comment: 'i-lucide-message-square',
    withdraw: 'i-lucide-undo-2',
}

const mayApprove = computed(() => open.value && canApprove(app.reviewer, status.value?.request, app.rules) && status.value?.state !== 'approved')
const unsavedHere = computed(() => b.value?.current && app.hasUnsaved)

onMounted(async () => {
    await app.flushEditor()
    await app.refreshDocs()
    if (!app.mainBranch) return
    const p = await window.api.previewMerge(app.repoDir!, props.branch, app.mainBranch.name).catch(() => null)
    files.value = (p?.files ?? []).filter((f) => f.toLowerCase().endsWith('.md'))
    file.value = files.value[0] ?? ''
})

watch(file, async (f) => {
    if (!f || !b.value || !app.mainBranch) return (rendered.value = null)
    const [oldSrc, newSrc] = await Promise.all([window.api.readAt(app.repoDir!, app.mainBranch.oid, f), window.api.readAt(app.repoDir!, b.value.oid, f)])
    const lang = docLang(newSrc || oldSrc || '')
    rendered.value = { html: withImages(renderCompareTable(compareSources(oldSrc ?? '', newSrc ?? ''), { omitUnchanged: true, lang }), app.repoDir, f), lang }
})

async function act(action: ReviewAction) {
    if (action === 'comment' && !text.value.trim()) return app.notify(t.value.review.commentRequired, true)
    const ok = await app.runOk(() => window.api.addReview(app.repoDir!, { branch: props.branch, action, text: text.value }))
    if (!ok) return
    text.value = ''
    await app.refreshDocs()
    app.notify(t.value.review.done[action])
}
</script>

<template>
    <UModal
        :open="true"
        :title="t.review.title(b?.label ?? branch)"
        :ui="{ content: 'cd-wide cd-modal-tall', body: 'cd-modal-split' }"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <div v-if="b && status" class="grid">
                <div class="side">
                    <div class="state">
                        <UBadge :label="STATE_LABEL[status.state]" :color="STATE_COLOR[status.state]" size="lg" variant="subtle" />
                        <span v-if="prOf(status.request)" class="muted">{{ reviewRefLabel(status.request?.forge ?? 'github', prOf(status.request)!) }}</span>
                    </div>
                    <p class="cd-muted">{{ t.review.rules(app.rules.requireApproval, app.rules.approvers) }}</p>

                    <ol class="timeline">
                        <li v-for="e in status.events" :key="e.id">
                            <UIcon :name="ACTION_ICON[e.action]" class="ev-icon" :class="e.action" />
                            <div>
                                <div>
                                    <strong>{{ e.by }}</strong> {{ t.review.events[e.action] }}<span class="cd-muted">　{{ fmtDate(e.at, 'mdhm') }}</span>
                                    <UBadge
                                        v-if="e.source === 'github' || e.source === 'gitlab'"
                                        :label="FORGE_LABEL[e.source]"
                                        size="sm"
                                        color="neutral"
                                        variant="outline"
                                    />
                                </div>
                                <div v-if="e.text" class="text">{{ e.text }}</div>
                            </div>
                        </li>
                        <li v-if="status.events.length === 0" class="muted">{{ t.review.noEvents }}</li>
                    </ol>

                    <UAlert v-if="unsavedHere" color="warning" variant="subtle" :title="t.review.unsaved" :description="t.review.unsavedHint" />
                    <UTextarea v-model="text" :rows="3" class="cd-full" :placeholder="open ? t.review.placeholderOpen : t.review.placeholderNew" />
                    <div class="actions">
                        <template v-if="!open || status.state === 'changes'">
                            <UButton
                                :label="open ? t.review.requestAgain : t.review.actions.request"
                                icon="i-lucide-send"
                                :loading="app.busy"
                                @click="act('request')"
                            />
                        </template>
                        <template v-if="open">
                            <UButton
                                v-if="mayApprove"
                                :label="t.review.actions.approve"
                                icon="i-lucide-badge-check"
                                color="success"
                                :loading="app.busy"
                                @click="act('approve')"
                            />
                            <UButton
                                v-if="mayApprove"
                                :label="t.review.actions.changes"
                                icon="i-lucide-pencil-line"
                                color="warning"
                                variant="soft"
                                :disabled="!text.trim()"
                                @click="act('changes')"
                            />
                            <UButton
                                :label="t.review.actions.comment"
                                icon="i-lucide-message-square"
                                color="neutral"
                                variant="outline"
                                @click="act('comment')"
                            />
                            <UButton :label="t.review.actions.withdraw" icon="i-lucide-undo-2" color="neutral" variant="ghost" @click="act('withdraw')" />
                        </template>
                    </div>
                </div>
                <div class="diff">
                    <div class="row">
                        <span class="cd-muted">{{ t.review.compareWithCurrent }}</span>
                        <USelect v-if="files.length > 1" v-model="file" :items="files" size="sm" />
                        <span v-else class="small">{{ file }}</span>
                    </div>
                    <div v-if="table" class="diff-body" v-html="table" />
                    <p v-else class="muted">{{ t.review.noDiff }}</p>
                </div>
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    grid-template-rows: minmax(0, 1fr);
    gap: 16px;
    height: 100%;
    min-height: 0;
}

.side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
}

.state {
    display: flex;
    align-items: center;
    gap: 8px;
}

.muted {
    color: var(--ui-text-muted);
}

.small {
    font-size: 12px;
    margin: 0;
}

.timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 0 1 auto;
    min-height: 60px;
    overflow: auto;
}

.timeline li {
    display: flex;
    gap: 8px;
    font-size: 13px;
}

.ev-icon {
    margin-top: 2px;
    flex-shrink: 0;
    color: var(--ui-text-muted);
}

.ev-icon.approve {
    color: var(--ui-color-success-500);
}

.ev-icon.changes {
    color: var(--ui-color-warning-500);
}

.text {
    white-space: pre-wrap;
    background: var(--ui-bg-elevated);
    padding: 4px 8px;
    border-radius: 6px;
    margin-top: 2px;
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.diff {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    min-height: 0;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.diff-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--ui-border);
    padding: 0 8px 8px;
    background: var(--cd-paper);
    color: var(--cd-ink);
}

.diff-body :deep(.cd-compare thead th) {
    position: sticky;
    top: 0;
    z-index: 1;
    box-shadow:
        inset 0 -1px 0 var(--cd-rule),
        inset 0 1px 0 var(--cd-rule),
        0 -8px 0 var(--cd-paper);
}
</style>
