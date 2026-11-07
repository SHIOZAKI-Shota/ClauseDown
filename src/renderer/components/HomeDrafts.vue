<script setup lang="ts">
import type { BranchInfo } from '@shared/api'
import { STATE_COLOR, STATE_LABEL } from '@shared/review'
import { useApp } from '~/stores/app'
import { fmtDate, relTime } from '~/utils/format'

const app = useApp()
const ORDER: Record<string, number> = { requested: 0, outdated: 0, changes: 1 }
const drafts = computed(() =>
    app.branches
        .filter((b) => !b.isMain)
        .sort(
            (a, b) =>
                Number(app.toReview.includes(b)) - Number(app.toReview.includes(a)) ||
                (ORDER[app.statusOf(a).state] ?? 2) - (ORDER[app.statusOf(b).state] ?? 2) ||
                b.timestamp - a.timestamp,
        ),
)
const waiting = (b: BranchInfo) => ['requested', 'outdated', 'changes'].includes(app.statusOf(b).state)
const mine = (b: BranchInfo) => app.toReview.includes(b)
</script>

<template>
    <section class="cd-side-sec">
        <SectionHead label="改定案" icon="i-lucide-git-branch" :count="drafts.length">
            <UTooltip text="新しい改定案">
                <UButton icon="i-lucide-plus" size="xs" square color="neutral" variant="ghost" aria-label="新しい改定案"
                    @click="app.dialog = { kind: 'newBranch' }" />
            </UTooltip>
        </SectionHead>
        <p v-if="!drafts.length" class="cd-muted empty">進行中の改定案はありません。大きな改定は「＋」から改定案を作ると、現行版を変えずに進められます。</p>
        <ul v-else class="list">
            <li v-for="b in drafts" :key="b.name" :class="{ mine: mine(b), current: b.current }">
                <div class="main">
                    <div class="name">
                        <strong :title="b.label">{{ b.label }}</strong>
                        <span v-if="b.current" class="here">作業中</span>
                    </div>
                    <div class="cd-muted meta">
                        <UBadge :label="mine(b) ? 'あなたの確認待ち' : STATE_LABEL[app.statusOf(b).state]"
                            :color="mine(b) ? 'primary' : STATE_COLOR[app.statusOf(b).state]" variant="subtle"
                            size="sm" />
                        <span :title="fmtDate(b.timestamp, 'ymdhm')">{{ b.author }}・{{ relTime(b.timestamp) }}</span>
                    </div>
                    <div v-if="b.mainMoved" class="warn">
                        <UIcon name="i-lucide-triangle-alert" />現行版のほうが先に更新されています
                    </div>
                </div>
                <div class="side">
                    <UButton v-if="waiting(b)" label="確認" size="xs" :color="mine(b) ? 'primary' : 'neutral'"
                        :variant="mine(b) ? 'solid' : 'outline'"
                        @click="app.dialog = { kind: 'review', branch: b.name }" />
                    <UButton v-if="!b.current" label="切り替え" size="xs" color="neutral" variant="ghost" class="switch"
                        @click="app.switchBranch(b.name)" />
                </div>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.empty {
    font-size: 12px;
    margin: 0;
}

.list {
    list-style: none;
    margin: 0 -8px;
    padding: 0;
}

li {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
}

li:hover {
    background: var(--ui-bg-elevated);
}

li.mine {
    background: color-mix(in oklab, var(--ui-color-primary-500) 8%, transparent);
}

.main {
    flex: 1;
    min-width: 0;
}

.name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}

.name strong {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.here {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--cd-draft);
}

.meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
}

.warn {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
    font-size: 11px;
    color: var(--ui-color-warning-600);
}

.side {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
}

.switch {
    opacity: 0;
}

li:hover .switch,
.switch:focus-visible {
    opacity: 1;
}
</style>
