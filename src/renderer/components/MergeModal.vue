<script setup lang="ts">
import type { ConflictChoice, MergePreview } from '@shared/api'
import { STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { todayISO } from '~/utils/format'
import { toPlain } from '~/utils/ipc'

const props = defineProps<{ from: string; into: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()

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
const title = computed(() =>
    adopting.value ? `「${fromLabel.value}」を現行版に反映` : `${fromLabel.value}の最新を「${intoLabel.value}」に取り込む`,
)
const status = computed(() => (adopting.value && fromB.value ? app.statusOf(fromB.value) : null))
const blocked = computed(() => !!status.value && !status.value.canMerge)

onMounted(async () => {
    await app.flushEditor()
    message.value = adopting.value ? `改定案「${fromLabel.value}」を現行版に反映` : `${fromLabel.value}の最新を取り込み`
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
    if (s.state === 'error') app.notify(`反映しましたが、リモートへの送信に失敗しました：${s.message}`, true)
    else app.notify(adopting.value ? `現行版に反映しました${deleteAfter.value ? '。改定案は削除しました' : ''}` : '取り込みました')
    emit('close')
}

const unresolved = computed(() => (preview.value?.conflicts ?? []).filter((c) => !choices.value[c.path]).length)
const hasConflicts = computed(() => !!preview.value?.conflicts.length)

const summary = computed(() => {
    const p = preview.value
    if (!p) return ''
    const parts = [`変わる文書 ${p.files.length} 件`]
    if (p.autoMerged.length) parts.push(`両方の変更を自動で統合 ${p.autoMerged.length} 件`)
    if (p.conflicts.length) parts.push(`同じ箇所の重なり ${p.conflicts.length} 件`)
    return parts.join('・')
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
                <UIcon name="i-lucide-shield-alert" />確認の状態：{{ STATE_LABEL[status.state] }}
                <UButton label="確認依頼を開く" size="xs" color="neutral" variant="link" @click="openReview" />
            </span>
            <span v-else-if="status?.state === 'approved'" class="notice ok">
                <UIcon name="i-lucide-badge-check" />{{ status.decision?.by }} さんが承認済み
            </span>
            <span v-if="app.hasUnsaved" class="notice warn">
                <UIcon name="i-lucide-triangle-alert" />保存していない変更があります
            </span>
        </template>

        <ConflictResolver v-model="choices" :conflicts="preview.conflicts" :ours-label="intoLabel"
            :theirs-label="fromLabel" />

        <template #footer>
            <UInput v-model="message" size="sm" class="memo" placeholder="記録するメモ" />
            <template v-if="adopting">
                <UCheckbox v-model="withDate" label="施行日" size="sm" />
                <DateField v-if="withDate" v-model="date" size="sm" />
                <UCheckbox v-model="deleteAfter" label="反映後に改定案を削除する" size="sm" />
            </template>
            <span class="cd-grow" />
            <UButton label="やめる" size="sm" color="neutral" variant="outline" @click="emit('close')" />
            <UButton :label="adopting ? '現行版に反映' : '取り込む'" size="sm"
                :disabled="app.hasUnsaved || blocked || unresolved > 0" :loading="app.busy" @click="apply" />
        </template>
    </WorkspaceModal>

    <UModal v-else :open="true" :title="title" :ui="{ content: 'cd-wide' }" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <p v-if="loading" class="muted">変更を調べています…</p>
                <template v-else-if="preview">
                    <UAlert v-if="app.hasUnsaved" color="warning" variant="subtle" icon="i-lucide-triangle-alert"
                        title="保存していない変更があります" description="先に「版を保存」するか「変更を取り消す」をしてください。" />
                    <UAlert v-if="blocked && status" color="warning" variant="subtle" icon="i-lucide-shield-alert"
                        :title="`確認の状態：${STATE_LABEL[status.state]}`" :description="status.reason"
                        :actions="[{ label: '確認依頼を開く', color: 'warning', variant: 'outline', onClick: openReview }]" />
                    <UAlert v-else-if="status && status.state === 'approved'" color="success" variant="subtle"
                        icon="i-lucide-badge-check" :title="`${status.decision?.by} さんが承認済みです`" />
                    <p v-if="preview.upToDate" class="muted">
                        {{ adopting ? 'この改定案には、まだ現行版に反映していない変更がありません。' : '取り込む変更はありません。すでに最新です。' }}
                    </p>
                    <template v-else>
                        <div>
                            <h3>変わる文書（{{ preview.files.length }}件）</h3>
                            <ul class="files">
                                <li v-for="f in preview.files" :key="f">
                                    {{ f }}
                                    <span v-if="preview.autoMerged.includes(f)" class="note">（両方の変更を自動で統合）</span>
                                </li>
                            </ul>
                        </div>
                        <UFormField label="記録するメモ">
                            <UInput v-model="message" class="cd-full" />
                        </UFormField>
                        <template v-if="adopting">
                            <div class="row">
                                <UCheckbox v-model="withDate" label="施行日を記録する" />
                                <DateField v-if="withDate" v-model="date" />
                            </div>
                            <UCheckbox v-model="deleteAfter" label="反映したあと、この改定案を削除する（リモートからも）" />
                        </template>
                    </template>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="preview?.upToDate ? '閉じる' : 'やめる'" color="neutral" variant="outline"
                    @click="emit('close')" />
                <UButton v-if="preview && !preview.upToDate" :label="adopting ? '現行版に反映' : '取り込む'"
                    :disabled="app.hasUnsaved || blocked || unresolved > 0" :loading="app.busy" @click="apply" />
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
