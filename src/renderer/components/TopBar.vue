<script setup lang="ts">
import { useApp, type View } from '~/stores/app'
import { firstLine, fmtDate } from '~/utils/format'

const app = useApp()

const tabs = [
    { label: '編集', value: 'editor', icon: 'i-lucide-pencil' },
    { label: '改定履歴', value: 'history', icon: 'i-lucide-git-commit-vertical' },
    { label: '新旧対照表', value: 'compare', icon: 'i-lucide-columns-2' },
    { label: '期日・納品', value: 'releases', icon: 'i-lucide-calendar-check' },
]
const docView = computed(() => app.currentDoc && tabs.some((t) => t.value === app.view))
const tab = computed({
    get: () => app.view,
    set: (v) => {
        if (v === 'compare') app.compareTarget = null
        app.view = v as View
    },
})

const lastSaved = ref<{ oid: string; message: string; author: string; timestamp: number } | null | undefined>(undefined)
let asked = 0
watch(
    () => [app.repoDir, app.currentPath, app.currentBranch?.oid, app.reloadKey] as const,
    async ([dir, path]) => {
        lastSaved.value = undefined
        if (!dir || !path) return
        const n = ++asked
        const r = await window.api.lastChange(dir, path).catch(() => undefined)
        if (n === asked) lastSaved.value = r
    },
    { immediate: true },
)
const savedAt = computed(() => (lastSaved.value ? fmtDate(lastSaved.value.timestamp, 'mdhm') : ''))
const versionTitle = computed(() =>
    lastSaved.value ? `${app.currentBranch?.label ?? ''}：「${savedMessage.value}」（${lastSaved.value.author}・${savedAt.value}）` : '',
)
const savedMessage = computed(() => (lastSaved.value ? firstLine(lastSaved.value.message) : ''))
</script>

<template>
    <UDashboardNavbar v-if="docView" :toggle="false" class="cd-nav">
        <template #left>
            <UTabs v-if="docView" v-model="tab" :items="tabs" :content="false" size="sm" variant="pill" />
        </template>
        <template v-if="docView" #default>
            <div class="doc">
                <strong class="title">{{ app.currentDoc!.title }}</strong>
                <span class="version" :title="versionTitle">
                    <span class="branch" :class="{ draft: app.onDraft }">{{ app.currentBranch?.label }}</span>
                    <template v-if="lastSaved">
                        <span class="msg">{{ savedMessage }}</span>
                        <span class="at">{{ savedAt }}</span>
                    </template>
                    <span v-else-if="lastSaved === null" class="msg">まだ保存していません</span>
                    <span v-if="app.currentDoc!.changed" class="dirty">＋保存していない変更</span>
                </span>
            </div>
        </template>
        <template v-if="docView" #right>
            <UButton
                label="期日"
                icon="i-lucide-calendar-range"
                size="sm"
                color="neutral"
                variant="ghost"
                :title="app.dueCount?.due ? `期限切れ ${app.dueCount.overdue} 件・30 日以内 ${app.dueCount.due - app.dueCount.overdue} 件` : undefined"
                @click="app.openSchedule()"
            >
                <template v-if="app.dueCount?.due" #trailing>
                    <UBadge :label="String(app.dueCount.due)" :color="app.dueCount.overdue ? 'error' : 'neutral'" variant="subtle" size="sm" />
                </template>
            </UButton>
            <UButton label="課題" icon="i-lucide-list-todo" size="sm" color="neutral" variant="ghost" @click="app.openIssues()">
                <template v-if="app.openIssueCount" #trailing>
                    <UBadge :label="String(app.openIssueCount)" color="neutral" variant="subtle" size="sm" />
                </template>
            </UButton>
            <UButton label="リポジトリホーム" icon="i-lucide-layout-grid" size="sm" color="neutral" variant="ghost" @click="app.goRepoHome()">
                <template v-if="app.toReview.length" #trailing>
                    <UBadge :label="`確認待ち ${app.toReview.length}`" color="warning" variant="subtle" size="sm" />
                </template>
            </UButton>
        </template>
    </UDashboardNavbar>
</template>

<style scoped>
.doc {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 0;
    max-width: 100%;
}

.title {
    font-size: 14px;
    white-space: nowrap;
    line-height: 1.3;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
}

.version {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    max-width: 100%;
}

.branch {
    font-weight: 600;
    color: var(--ui-color-primary-500);
}

.branch.draft {
    color: var(--cd-draft);
}

.version > * {
    flex-shrink: 0;
}

.version > .msg {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}

.at {
    color: var(--ui-text-dimmed);
}

.dirty {
    color: var(--cd-draft);
}
</style>

<style>
/* UDashboardNavbar の中の要素には scoped の印が付かないので、ここは scoped にしない */
.cd-nav {
    display: grid !important;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
    column-gap: 16px;
}

.cd-nav > [data-slot='center'] {
    min-width: 0;
    justify-content: center;
    overflow: hidden;
}

.cd-nav > [data-slot='right'] {
    justify-self: end;
}
</style>
