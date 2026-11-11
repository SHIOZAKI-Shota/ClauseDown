<script setup lang="ts">
import { STATE_COLOR, STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { fmtDate } from '~/utils/format'

const app = useApp()
const open = ref(false)
const linkDraft = ref<{ name: string; label: string } | null>(null)

const groups = computed(() => {
    const item = (b: (typeof app.branches)[number]) => {
        const s = b.isMain ? null : app.statusOf(b)
        return {
            label: b.label,
            suffix: b.isMain ? '正式な最新の版' : `未反映 ${b.changes} 版・${b.author}・${fmtDate(b.timestamp, 'md')}${b.remote ? '' : '・未送信'}`,
            icon: b.isMain ? 'i-lucide-book-check' : 'i-lucide-file-pen-line',
            active: b.current,
            chip: s && s.state !== 'none' ? { color: STATE_COLOR[s.state] } : undefined,
            description: s && s.state !== 'none' ? STATE_LABEL[s.state] : b.mainMoved ? '現行版が更新されています' : undefined,
            onSelect: () => {
                open.value = false
                if (!b.current) app.switchBranch(b.name)
            },
        }
    }
    return [
        { id: 'main', items: app.branches.filter((b) => b.isMain).map(item) },
        { id: 'drafts', label: '改定案', items: app.branches.filter((b) => !b.isMain && b.local).map(item) },
        { id: 'others', label: '他の人の改定案（未取得）', items: app.branches.filter((b) => !b.isMain && !b.local).map(item) },
        {
            id: 'new',
            items: [
                {
                    label: 'リポジトリホーム',
                    icon: 'i-lucide-layout-grid',
                    onSelect: () => {
                        open.value = false
                        app.goRepoHome()
                    },
                },
                {
                    label: '期日',
                    icon: 'i-lucide-calendar-range',
                    suffix: app.dueCount?.due
                        ? app.dueCount.overdue
                            ? `期限切れ ${app.dueCount.overdue}`
                            : `30 日以内 ${app.dueCount.due}`
                        : undefined,
                    onSelect: () => {
                        open.value = false
                        app.openSchedule()
                    },
                },
                {
                    label: '課題',
                    icon: 'i-lucide-list-todo',
                    suffix: app.openIssueCount ? `未完了 ${app.openIssueCount}` : undefined,
                    onSelect: () => {
                        open.value = false
                        app.openIssues()
                    },
                },
                ...(app.onDraft && app.currentBranch
                    ? [
                        {
                            label: 'この改定案で解決する課題…',
                            icon: 'i-lucide-list-checks',
                            onSelect: () => {
                                open.value = false
                                linkDraft.value = { name: app.currentBranch!.name, label: app.currentBranch!.label }
                            },
                        },
                    ]
                    : []),
                {
                    label: '新しい改定案',
                    icon: 'i-lucide-plus',
                    onSelect: () => {
                        open.value = false
                        app.dialog = { kind: 'newBranch' }
                    },
                },
            ],
        },
    ]
})
const title = computed(() => `作業中の案：${app.currentBranch?.label ?? ''}\n（押すと切り替え・新しい改定案）`)
</script>

<template>
    <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
        <button class="cd-crumb-btn branch" :class="{ draft: app.onDraft, open }" :title="title"
            aria-label="作業中の案を切り替える">
            <UIcon :name="app.onDraft ? 'i-lucide-file-pen-line' : 'i-lucide-book-check'" class="ci" />
            <span v-if="app.onDraft" class="tag">案</span>
            <span class="nm">{{ app.currentBranch?.label }}</span>
            <UIcon name="i-lucide-chevron-down" class="caret" />
        </button>
        <template #content>
            <UCommandPalette :groups="groups" placeholder="改定案を検索" class="palette" />
        </template>
    </UPopover>
    <IssueLinkModal v-if="linkDraft" :branch="linkDraft.name" :branch-label="linkDraft.label"
        @close="linkDraft = null" />
</template>

<style scoped>
.palette {
    width: 400px;
    max-height: 65vh;
}
</style>
