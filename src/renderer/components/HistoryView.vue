<script setup lang="ts">
import { fmtDate } from '~/utils/format'
import type { CommitInfo, SigInfo } from '@shared/api'
import { useApp } from '~/stores/app'
import { usePane } from '~/composables/usePane'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const path = app.currentPath!
const listPane = usePane('history', { size: 460, min: 300, max: 1000 })
const onlyThis = ref(true)
const allBranches = ref(true)
const commits = ref<CommitInfo[]>([])
const selected = ref<string | null>(null)
const content = ref<string | null | undefined>(undefined)
const confirmRestore = ref(false)
const showEffective = ref(false)
const showLink = ref(false)
const loading = ref(true)

const sigs = ref<Record<string, SigInfo>>({})
let seq = 0
async function load() {
    const n = ++seq
    loading.value = true
    const list = (await app.run(() => window.api.log(app.repoDir!, onlyThis.value ? path : undefined, allBranches.value))) ?? []
    if (n !== seq) return
    commits.value = list
    loading.value = false
    const missing = list.map((c) => c.oid).filter((oid) => !sigs.value[oid])
    if (missing.length && !isDemo())
        void window.api
            .verifyCommits(app.repoDir!, missing)
            .then((got) => n === seq && (sigs.value = { ...sigs.value, ...got }))
            .catch(() => {})
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
const currentLabel = computed(() => app.currentBranch?.label ?? t.value.history.currentFallback)
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
    if (!prev) return app.notify(t.value.history.noPrevious, true)
    app.openCompare(prev, selected.value!)
}

function compareWithCurrent() {
    app.openCompare(selected.value!, 'work')
}

async function restore() {
    confirmRestore.value = false
    confirmBring.value = false
    if (typeof content.value !== 'string') return
    const done = onCurrent.value ? t.value.history.restored : t.value.history.copied(currentLabel.value)
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
        <SidePane :pane="listPane" side="left" :label="t.history.listLabel" icon="i-lucide-git-commit-horizontal">
            <div class="head">
                <UCheckbox v-model="onlyThis" :label="t.history.onlyThisDoc" />
                <UCheckbox v-model="allBranches" :label="t.history.allDrafts" />
            </div>
            <p v-if="loading && commits.length === 0" class="muted pad">{{ t.history.loading }}</p>
            <p v-else-if="commits.length === 0" class="muted pad">{{ t.history.empty }}</p>
            <HistoryGraph
                :commits="commits"
                :selected="selected"
                :pending="!!app.currentDoc?.changed"
                :current-label="app.currentBranch?.label"
                :sigs="sigs"
                @select="selected = $event"
            />
            <div v-if="commits.length" class="legend">
                <span><i class="ln main" />{{ t.history.legend.main }}</span>
                <span><i class="ln draft" />{{ t.history.legend.draft }}</span>
                <span><i class="ln faint" />{{ t.history.legend.faint }}</span>
            </div>
        </SidePane>
        <div class="detail">
            <template v-if="selectedCommit">
                <div class="cd-toolbar actions">
                    <div class="msg">
                        <IssueText
                            :text="
                                selectedCommit.message.replace(
                                    /(^|\n)施行日: (\S+)\s*$/,
                                    (_, head, date) => `${head}${t.history.effectiveTrailer}: ${fmtDate(date, 'ymd')}`,
                                )
                            "
                        />
                    </div>
                    <span class="cd-grow" />
                    <UButton :label="t.history.linkIssue" icon="i-lucide-link" size="sm" color="neutral" variant="outline" @click="showLink = true" />
                    <UButton :label="t.history.comparePrevious" size="sm" color="neutral" variant="outline" data-guide="compare" @click="compareWithPrevious" />
                    <UButton :label="t.history.compareCurrent" size="sm" color="neutral" variant="outline" data-guide="compare" @click="compareWithCurrent" />
                    <UButton
                        :label="t.history.addEffective"
                        icon="i-lucide-calendar-check"
                        data-guide="effective"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        :disabled="typeof content !== 'string'"
                        @click="showEffective = true"
                    />
                    <UButton
                        v-if="onCurrent"
                        :label="t.history.restore"
                        icon="i-lucide-history"
                        data-guide="restore"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        :disabled="typeof content !== 'string'"
                        @click="confirmRestore = true"
                    />
                    <template v-else>
                        <UTooltip :text="targetBranch ? '' : t.history.draftDeleted">
                            <UButton
                                :label="targetBranch ? t.history.switchTo(targetBranch.label) : t.history.noSwitchTarget"
                                icon="i-lucide-git-branch"
                                size="sm"
                                :disabled="!targetBranch"
                                @click="switchToTarget"
                            />
                        </UTooltip>
                        <UButton
                            :label="t.history.copyInto(currentLabel)"
                            icon="i-lucide-download"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            :disabled="typeof content !== 'string'"
                            @click="confirmBring = true"
                        />
                    </template>
                </div>
                <DocPaper :text="content" :doc-path="path" />
            </template>
        </div>
        <IssueLinkModal v-if="showLink && selectedCommit" :oid="selectedCommit.oid" @close="showLink = false" />
        <EffectiveDateModal
            v-if="showEffective && selectedCommit"
            :oid="selectedCommit.oid"
            :path="path"
            @close="showEffective = false"
            @done="onEffectiveAdded"
        />
        <ConfirmModal
            v-model:open="confirmBring"
            :title="t.history.copyTitle(currentLabel)"
            :description="t.history.copyDescription(currentLabel)"
            :confirm-label="t.history.copyTitle(currentLabel)"
            @confirm="restore"
        />
        <ConfirmModal
            v-model:open="confirmRestore"
            :title="t.history.restore"
            :description="t.history.restoreDescription"
            :confirm-label="t.history.restoreConfirm"
            @confirm="restore"
        />
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
