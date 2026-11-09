<script setup lang="ts">
import type { CommitInfo } from '@shared/api'
import { useApp } from '~/stores/app'
import { usePane } from '~/composables/usePane'

const app = useApp()
const path = app.currentPath!
const listPane = usePane('history', { size: 460, min: 300, max: 1000 })
const onlyThis = ref(true)
const allBranches = ref(true)
const commits = ref<CommitInfo[]>([])
const selected = ref<string | null>(null)
const content = ref<string | null | undefined>(undefined)
const confirmRestore = ref(false)
const showEffective = ref(false)
const loading = ref(true)

let seq = 0
async function load() {
    const n = ++seq
    loading.value = true
    const list = (await app.run(() => window.api.log(app.repoDir!, onlyThis.value ? path : undefined, allBranches.value))) ?? []
    if (n !== seq) return
    commits.value = list
    loading.value = false
    if (app.historySelect && commits.value.some((c) => c.oid === app.historySelect)) selected.value = app.historySelect
    app.historySelect = null
    if (!commits.value.some((c) => c.oid === selected.value)) selected.value = commits.value[0]?.oid ?? null
}

watch([onlyThis, allBranches], load)
watch(selected, async (oid) => {
    content.value = undefined
    const text = oid ? await window.api.readAt(app.repoDir!, oid, path) : null
    if (selected.value === oid) content.value = text
})
onMounted(load)

const selectedCommit = computed(() => commits.value.find((c) => c.oid === selected.value))

const onCurrent = computed(() => !!selectedCommit.value?.onCurrent)
const currentLabel = computed(() => app.currentBranch?.label ?? '今の案')
const targetBranch = computed(() => {
    const c = selectedCommit.value
    if (!c || c.onCurrent) return null
    const names = c.lines ?? []
    const byTip = app.branches.find((b) => !b.current && names.includes(b.name) && b.oid === c.oid)
    const any = app.branches.find((b) => !b.current && names.includes(b.name))
    return byTip ?? any ?? null
})
const confirmBring = ref(false)

async function switchToTarget() {
    const b = targetBranch.value
    if (!b) return
    app.historySelect = selected.value
    await app.switchBranch(b.name)
}

function compareWithPrevious() {
    const prev = selectedCommit.value?.parents[0]
    if (!prev) return app.notify('これより前の版はありません', true)
    app.openCompare(prev, selected.value!)
}

function compareWithCurrent() {
    app.openCompare(selected.value!, 'work')
}

async function restore() {
    confirmRestore.value = false
    confirmBring.value = false
    if (typeof content.value !== 'string') return
    const done = onCurrent.value
        ? 'この版の内容に戻しました。確認して「版を保存」してください'
        : `この版の内容を「${currentLabel.value}」にコピーしました。確認して「版を保存」してください`
    await app.run(() => window.api.writeDoc(app.repoDir!, path, content.value as string), done)
    await app.refreshDocs()
    app.view = 'editor'
}

async function onEffectiveAdded() {
    showEffective.value = false
    await load()
}
</script>

<template>
    <div class="history">
        <SidePane :pane="listPane" side="left" label="版の一覧" icon="i-lucide-git-commit-horizontal">
            <div class="head">
                <UCheckbox v-model="onlyThis" label="この文書の変更のみ" />
                <UCheckbox v-model="allBranches" label="すべての改定案を表示" />
            </div>
            <p v-if="loading && commits.length === 0" class="muted pad">読み込んでいます…</p>
            <p v-else-if="commits.length === 0" class="muted pad">まだ版が保存されていません。</p>
            <HistoryGraph :commits="commits" :selected="selected" :pending="!!app.currentDoc?.changed"
                :current-label="app.currentBranch?.label" @select="selected = $event" />
            <div v-if="commits.length" class="legend">
                <span><i class="ln main" />現行版</span>
                <span><i class="ln draft" />改定案</span>
                <span><i class="ln faint" />ほかの改定案（薄く表示）</span>
            </div>
        </SidePane>
        <div class="detail">
            <template v-if="selectedCommit">
                <div class="cd-toolbar actions">
                    <div class="msg">{{ selectedCommit.message }}</div>
                    <span class="cd-grow" />
                    <UButton label="前の版と比較" size="sm" color="neutral" variant="outline" @click="compareWithPrevious" />
                    <UButton label="今の文書と比較" size="sm" color="neutral" variant="outline" @click="compareWithCurrent" />
                    <UButton label="施行日を付ける" icon="i-lucide-calendar-check" size="sm" color="neutral" variant="outline"
                        :disabled="typeof content !== 'string'" @click="showEffective = true" />
                    <UButton v-if="onCurrent" label="この版に戻す" icon="i-lucide-history" size="sm" color="neutral"
                        variant="outline" :disabled="typeof content !== 'string'" @click="confirmRestore = true" />
                    <template v-else>
                        <UTooltip :text="targetBranch ? '' : 'この版がある改定案は、反映後に削除されています'">
                            <UButton :label="targetBranch ? `「${targetBranch.label}」に切り替える` : '切り替え先の案がありません'"
                                icon="i-lucide-git-branch" size="sm" :disabled="!targetBranch"
                                @click="switchToTarget" />
                        </UTooltip>
                        <UButton :label="`この版の内容を「${currentLabel}」にコピー`" icon="i-lucide-download" size="sm"
                            color="neutral" variant="outline" :disabled="typeof content !== 'string'"
                            @click="confirmBring = true" />
                    </template>
                </div>
                <DocPaper :text="content" :doc-path="path" />
            </template>
        </div>
        <EffectiveDateModal v-if="showEffective && selectedCommit" :oid="selectedCommit.oid" :path="path"
            @close="showEffective = false" @done="onEffectiveAdded" />
        <ConfirmModal v-model:open="confirmBring" :title="`「${currentLabel}」にコピー`"
            :description="`別の案にある版の内容で、「${currentLabel}」のこの文書を置き換えます。作業中の案は切り替わりません。置き換えたあと「版を保存」すると、「${currentLabel}」の版として記録されます。`"
            :confirm-label="`「${currentLabel}」にコピー`" @confirm="restore" />
        <ConfirmModal v-model:open="confirmRestore" title="この版に戻す"
            description="この版の内容で今の文書を置き換えます。置き換えたあと「版を保存」すると記録されます。" confirm-label="戻す" @confirm="restore" />
    </div>
</template>

<style scoped>
.history {
    display: flex;
    height: 100%;
}

.legend {
    display: flex;
    gap: 14px;
    padding: 10px 14px;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.ln {
    display: inline-block;
    width: 16px;
    height: 3px;
    border-radius: 2px;
}

.ln.main {
    background: var(--ui-color-primary-500);
}

.ln.draft {
    background: var(--cd-draft);
}

.ln.faint {
    background: var(--ui-text-dimmed);
    opacity: 0.5;
}

.head {
    display: flex;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--ui-border);
    position: sticky;
    top: 0;
    background: var(--ui-bg);
    z-index: 1;
}

.muted {
    color: var(--ui-text-muted);
}

.pad {
    padding: 12px;
}

.detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.actions {
    padding: 10px 16px;
}

.msg {
    white-space: pre-wrap;
    font-size: 13px;
}
</style>
