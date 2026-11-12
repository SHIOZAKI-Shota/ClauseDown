<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { STATE_COLOR, STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'

const app = useApp()
const confirmDiscard = ref(false)

const status = computed(() => app.currentStatus)
const stateColor = computed(() => STATE_COLOR[status.value?.state ?? 'none'])

function compareWithMain() {
    if (!app.currentPath || !app.mainBranch) {
        app.notify('比較する文書を左の一覧から開いてください', true)
        return
    }
    app.openCompare(app.mainBranch.oid, 'work')
}

const adopt = () => (app.dialog = { kind: 'merge', from: app.currentBranch!.name, into: app.mainBranch!.name })
const review = () => (app.dialog = { kind: 'review', branch: app.currentBranch!.name })

const more = computed<DropdownMenuItem[]>(() => [
    {
        label: '現行版の最新を取り込む',
        icon: 'i-lucide-download',
        onSelect: () => (app.dialog = { kind: 'merge', from: app.mainBranch!.name, into: app.currentBranch!.name }),
    },
    { label: '取り下げる（削除）', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (confirmDiscard.value = true) },
])

async function discard() {
    await app.flushEditor()
    const b = app.currentBranch!
    const ok = await app.runOk(() => window.api.deleteBranch(app.repoDir!, b.name))
    confirmDiscard.value = false
    if (!ok) return
    await app.afterBranchChange()
    app.notify(`改定案「${b.label}」を取り下げ、現行版に戻りました`)
}
</script>

<template>
    <div v-if="app.onDraft && app.currentBranch" class="banner">
        <UIcon name="i-lucide-file-pen-line" class="icon" />
        <span class="text"> 改定案<strong>「{{ app.currentBranch.label }}」</strong>で作業中です。ここでの変更は現行版に影響しません。 </span>
        <UBadge v-if="app.currentBranch.mainMoved" label="現行版が更新されています" color="warning" variant="outline" size="sm" />
        <span class="cd-grow" />
        <UButton
            :label="status && status.state !== 'none' ? STATE_LABEL[status.state] : '確認を依頼'"
            :color="stateColor"
            variant="soft"
            size="sm"
            icon="i-lucide-message-square-check"
            @click="review"
        />
        <UButton label="現行版と比較" size="sm" color="neutral" variant="outline" icon="i-lucide-columns-2" @click="compareWithMain" />
        <UButton label="現行版に反映…" size="sm" icon="i-lucide-git-merge" @click="adopt" />
        <UDropdownMenu :items="more">
            <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" />
        </UDropdownMenu>
        <ConfirmModal v-model:open="confirmDiscard" title="改定案を取り下げる" confirm-label="取り下げる" color="error" :loading="app.busy" @confirm="discard">
            <p>
                改定案「{{ app.currentBranch.label }}」を削除し、現行版に戻ります。
                {{ app.currentBranch.remote ? 'リモートからも削除され、他の人も見られなくなります。' : '' }}
                現行版には影響しません。
            </p>
        </ConfirmModal>
    </div>
</template>

<style scoped>
.banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    flex-wrap: wrap;
    font-size: 13px;
    background: var(--cd-draft-bg);
    border-bottom: 1px solid var(--cd-draft-border);
}

.icon {
    color: var(--cd-draft);
}

.text strong {
    color: var(--cd-draft);
}
</style>
