<script setup lang="ts">
import { STATE_COLOR, STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { fmtDate } from '~/utils/format'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const open = ref(false)
const linkDraft = ref<{ name: string; label: string } | null>(null)

const groups = computed(() => {
    const m = t.value.sync.branchMenu
    const item = (b: (typeof app.branches)[number]) => {
        const s = b.isMain ? null : app.statusOf(b)
        return {
            label: b.label,
            suffix: b.isMain ? m.mainSuffix : m.draftSuffix(b.changes, b.author, fmtDate(b.timestamp, 'md'), !!b.remote),
            icon: b.isMain ? 'i-lucide-book-check' : 'i-lucide-file-pen-line',
            active: b.current,
            chip: s && s.state !== 'none' ? { color: STATE_COLOR[s.state] } : undefined,
            description: s && s.state !== 'none' ? STATE_LABEL[s.state] : b.mainMoved ? t.value.sync.banner.mainMoved : undefined,
            onSelect: () => {
                open.value = false
                if (!b.current) app.switchBranch(b.name)
            },
        }
    }
    return [
        { id: 'main', items: app.branches.filter((b) => b.isMain).map(item) },
        { id: 'drafts', label: m.drafts, items: app.branches.filter((b) => !b.isMain && b.local).map(item) },
        { id: 'others', label: m.others, items: app.branches.filter((b) => !b.isMain && !b.local).map(item) },
        {
            id: 'new',
            items: [
                {
                    label: m.home,
                    icon: 'i-lucide-layout-grid',
                    onSelect: () => {
                        open.value = false
                        app.goRepoHome()
                    },
                },
                {
                    label: m.schedule,
                    icon: 'i-lucide-calendar-range',
                    suffix: app.dueCount?.due ? (app.dueCount.overdue ? m.overdue(app.dueCount.overdue) : m.dueSoon(app.dueCount.due)) : undefined,
                    onSelect: () => {
                        open.value = false
                        app.openSchedule()
                    },
                },
                {
                    label: m.issues,
                    icon: 'i-lucide-list-todo',
                    suffix: app.openIssueCount ? m.openIssues(app.openIssueCount) : undefined,
                    onSelect: () => {
                        open.value = false
                        app.openIssues()
                    },
                },
                ...(app.onDraft && app.currentBranch
                    ? [
                          {
                              label: m.linkIssues,
                              icon: 'i-lucide-list-checks',
                              onSelect: () => {
                                  open.value = false
                                  linkDraft.value = { name: app.currentBranch!.name, label: app.currentBranch!.label }
                              },
                          },
                      ]
                    : []),
                {
                    label: m.newDraft,
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
const title = computed(() => t.value.sync.branchMenu.title(app.currentBranch?.label ?? ''))
</script>

<template>
    <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
        <button class="cd-crumb-btn branch" data-guide="branch" :class="{ draft: app.onDraft, open }" :title="title" :aria-label="t.sync.branchMenu.aria">
            <UIcon :name="app.onDraft ? 'i-lucide-file-pen-line' : 'i-lucide-book-check'" class="ci" />
            <span v-if="app.onDraft" class="tag">{{ t.sync.branchMenu.draftTag }}</span>
            <span class="nm">{{ app.currentBranch?.label }}</span>
            <UIcon name="i-lucide-chevron-down" class="caret" />
        </button>
        <template #content>
            <UCommandPalette :groups="groups" :placeholder="t.sync.branchMenu.search" class="palette" />
        </template>
    </UPopover>
    <IssueLinkModal v-if="linkDraft" :branch="linkDraft.name" :branch-label="linkDraft.label" @close="linkDraft = null" />
</template>

<style scoped>
.palette {
    width: 400px;
    max-height: 65vh;
}
</style>
