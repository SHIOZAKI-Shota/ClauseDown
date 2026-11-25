<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { STATE_COLOR, STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const confirmDiscard = ref(false)

const status = computed(() => app.currentStatus)
const stateColor = computed(() => STATE_COLOR[status.value?.state ?? 'none'])

function compareWithMain() {
    if (!app.currentPath || !app.mainBranch) {
        app.notify(t.value.sync.banner.openDocFirst, true)
        return
    }
    app.openCompare(app.mainBranch.oid, 'work')
}

const adopt = () => (app.dialog = { kind: 'merge', from: app.currentBranch!.name, into: app.mainBranch!.name })
const review = () => (app.dialog = { kind: 'review', branch: app.currentBranch!.name })

const more = computed<DropdownMenuItem[]>(() => [
    {
        label: t.value.sync.banner.pullMain,
        icon: 'i-lucide-download',
        onSelect: () => (app.dialog = { kind: 'merge', from: app.mainBranch!.name, into: app.currentBranch!.name }),
    },
    { label: t.value.sync.banner.discard, icon: 'i-lucide-trash-2', color: 'error', onSelect: () => (confirmDiscard.value = true) },
])

async function discard() {
    await app.flushEditor()
    const b = app.currentBranch!
    const ok = await app.runOk(() => window.api.deleteBranch(app.repoDir!, b.name))
    confirmDiscard.value = false
    if (!ok) return
    await app.afterBranchChange()
    app.notify(t.value.sync.banner.discarded(b.label))
}
</script>

<template>
    <div v-if="app.onDraft && app.currentBranch" class="banner">
        <UIcon name="i-lucide-file-pen-line" class="icon" />
        <span class="text"
            >{{ t.sync.banner.working.a }}<strong>{{ t.sync.banner.working.b(app.currentBranch.label) }}</strong>{{ t.sync.banner.working.c }}</span
        >
        <UBadge v-if="app.currentBranch.mainMoved" :label="t.sync.banner.mainMoved" color="warning" variant="outline" size="sm" />
        <span class="cd-grow" />
        <UButton
            :label="status && status.state !== 'none' ? STATE_LABEL[status.state] : t.sync.banner.requestReview"
            :color="stateColor"
            variant="soft"
            size="sm"
            icon="i-lucide-message-square-check"
            @click="review"
        />
        <UButton
            :label="t.sync.banner.compare"
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-columns-2"
            data-guide="branch"
            @click="compareWithMain"
        />
        <UButton :label="t.sync.banner.merge" size="sm" icon="i-lucide-git-merge" data-guide="branch" @click="adopt" />
        <UDropdownMenu :items="more">
            <UButton icon="i-lucide-ellipsis" size="sm" color="neutral" variant="ghost" :aria-label="t.common.more" />
        </UDropdownMenu>
        <ConfirmModal
            v-model:open="confirmDiscard"
            :title="t.sync.banner.discardTitle"
            :confirm-label="t.sync.banner.discardConfirm"
            color="error"
            :loading="app.busy"
            @confirm="discard"
        >
            <p>{{ t.sync.banner.discardBody(app.currentBranch.label, !!app.currentBranch.remote) }}</p>
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
