<script setup lang="ts">
import type { ConflictChoice, MergePreview } from '@shared/api'
import { STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { todayISO } from '~/utils/format'
import { toPlain } from '~/utils/ipc'
import { useT } from '~/composables/useT'

const props = defineProps<{ from: string; into: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()

const preview = ref<MergePreview | null>(null)
const loading = ref(true)
const choices = ref<Record<string, ConflictChoice>>({})
const withDate = ref(false)
const date = ref(todayISO())
const deleteAfter = ref(true)
const message = ref('')

const fromB = computed(() => app.branches.find((b) => b.name === props.from))
const intoB = computed(() => app.branches.find((b) => b.name === props.into))
const fromLabel = computed(() => fromB.value?.label ?? props.from)
const intoLabel = computed(() => intoB.value?.label ?? props.into)
const adopting = computed(() => !!intoB.value?.isMain)
const title = computed(() => (adopting.value ? t.value.merge.titleAdopt(fromLabel.value) : t.value.merge.titleUpdate(fromLabel.value, intoLabel.value)))
const status = computed(() => (adopting.value && fromB.value ? app.statusOf(fromB.value) : null))
const blocked = computed(() => !!status.value && !status.value.canMerge)

onMounted(async () => {
    await app.flushEditor()
    message.value = adopting.value ? t.value.merge.messageAdopt(fromLabel.value) : t.value.merge.messageUpdate(fromLabel.value)
    if (app.repo?.url) await app.sync()
    else await app.refreshDocs()
    preview.value = (await app.run(() => window.api.previewMerge(app.repoDir!, props.from, props.into))) ?? null
    loading.value = false
})

async function apply() {
    const s = await app.run(() =>
        window.api.mergeBranch(app.repoDir!, {
            from: props.from,
            into: props.into,
            choices: toPlain(choices.value),
            message: message.value.trim() || title.value,
            effectiveDate: adopting.value && withDate.value ? date.value : undefined,
            deleteAfter: adopting.value && deleteAfter.value,
        }),
    )
    if (!s) return
    app.syncState = s
    await app.afterBranchChange()
    void app.refreshIssueCount()
    if (s.state === 'error') app.notify(t.value.merge.pushFailed(s.message ?? ''), true)
    else app.notify(adopting.value ? t.value.merge.adopted(deleteAfter.value) : t.value.merge.updated)
    emit('close')
}

const unresolved = computed(() => (preview.value?.conflicts ?? []).filter((c) => !choices.value[c.path]).length)
const hasConflicts = computed(() => !!preview.value?.conflicts.length)

const summary = computed(() => {
    const p = preview.value
    if (!p) return ''
    const m = t.value.merge
    const parts = [m.summaryFiles(p.files.length)]
    if (p.autoMerged.length) parts.push(m.summaryAuto(p.autoMerged.length))
    if (p.conflicts.length) parts.push(m.summaryConflicts(p.conflicts.length))
    return parts.join(m.summarySep)
})

function openReview() {
    emit('close')
    app.dialog = { kind: 'review', branch: props.from }
}
</script>

<template>
    <WorkspaceModal v-if="preview && hasConflicts" :title="title" :summary="summary" @close="emit('close')">
        <template #actions>
            <span v-if="blocked && status" class="notice warn">
                <UIcon name="i-lucide-shield-alert" />{{ t.merge.reviewState(STATE_LABEL[status.state]) }}
                <UButton :label="t.merge.openReview" size="xs" color="neutral" variant="link" @click="openReview" />
            </span>
            <span v-else-if="status?.state === 'approved'" class="notice ok">
                <UIcon name="i-lucide-badge-check" />{{ t.merge.approvedBy(status.decision?.by ?? '') }}
            </span>
            <span v-if="app.hasUnsaved" class="notice warn"> <UIcon name="i-lucide-triangle-alert" />{{ t.merge.unsaved }} </span>
        </template>

        <ConflictResolver v-model="choices" :conflicts="preview.conflicts" :ours-label="intoLabel" :theirs-label="fromLabel" />

        <template #footer>
            <UInput v-model="message" size="sm" class="memo" :placeholder="t.merge.memo" />
            <template v-if="adopting">
                <UCheckbox v-model="withDate" :label="t.merge.effectiveDate" size="sm" data-guide="effective" />
                <DateField v-if="withDate" v-model="date" size="sm" />
                <UCheckbox v-model="deleteAfter" :label="t.merge.deleteAfterShort" size="sm" />
            </template>
            <span class="cd-grow" />
            <UButton :label="t.merge.cancel" size="sm" color="neutral" variant="outline" @click="emit('close')" />
            <UButton
                :label="adopting ? t.merge.adopt : t.merge.update"
                size="sm"
                :disabled="app.hasUnsaved || blocked || unresolved > 0"
                :loading="app.busy"
                @click="apply"
            />
        </template>
    </WorkspaceModal>

    <UModal v-else :open="true" :title="title" :ui="{ content: 'cd-wide' }" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <p v-if="loading" class="muted">{{ t.merge.checking }}</p>
                <template v-else-if="preview">
                    <UAlert
                        v-if="app.hasUnsaved"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        :title="t.merge.unsaved"
                        :description="t.merge.unsavedHint"
                    />
                    <UAlert
                        v-if="blocked && status"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-shield-alert"
                        :title="t.merge.reviewState(STATE_LABEL[status.state])"
                        :description="status.reason"
                        :actions="[{ label: t.merge.openReview, color: 'warning', variant: 'outline', onClick: openReview }]"
                    />
                    <UAlert
                        v-else-if="status && status.state === 'approved'"
                        color="success"
                        variant="subtle"
                        icon="i-lucide-badge-check"
                        :title="t.merge.approvedByFull(status.decision?.by ?? '')"
                    />
                    <p v-if="preview.upToDate" class="muted">
                        {{ adopting ? t.merge.nothingToAdopt : t.merge.upToDate }}
                    </p>
                    <template v-else>
                        <div>
                            <h3>{{ t.merge.filesHeading(preview.files.length) }}</h3>
                            <ul class="files">
                                <li v-for="f in preview.files" :key="f">
                                    {{ f }}
                                    <span v-if="preview.autoMerged.includes(f)" class="note">{{ t.merge.autoMergedNote }}</span>
                                </li>
                            </ul>
                        </div>
                        <UFormField :label="t.merge.memo">
                            <UInput v-model="message" class="cd-full" />
                        </UFormField>
                        <template v-if="adopting">
                            <div class="row">
                                <UCheckbox v-model="withDate" :label="t.merge.recordEffective" data-guide="effective" />
                                <DateField v-if="withDate" v-model="date" />
                            </div>
                            <UCheckbox v-model="deleteAfter" :label="t.merge.deleteAfter" />
                        </template>
                    </template>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="preview?.upToDate ? t.common.close : t.merge.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton
                    v-if="preview && !preview.upToDate"
                    :label="adopting ? t.merge.adopt : t.merge.update"
                    :disabled="app.hasUnsaved || blocked || unresolved > 0"
                    :loading="app.busy"
                    @click="apply"
                />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.row {
    display: flex;
    gap: 12px;
    align-items: center;
}

h3 {
    font-weight: 700;
    margin: 0 0 4px;
}

.memo {
    width: 360px;
}

.notice {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
}

.notice.warn {
    color: var(--cd-draft);
}

.notice.ok {
    color: var(--ui-color-success-500);
}

.note {
    font-size: 12px;
    color: var(--ui-text-muted);
}

.files {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    list-style: disc;
}

.muted {
    color: var(--ui-text-muted);
    font-size: 12px;
    margin: 0;
    white-space: nowrap;
}
</style>
