<script setup lang="ts">
import { useApp } from '~/stores/app'
import { allFolders } from '~/utils/folders'

const app = useApp()
const unsaved = computed(() => app.docs.filter((d) => d.changed))
const folders = computed(() => allFolders(app.docs).length)
const remote = computed(() => app.repo?.url?.replace(/^https?:\/\//, '').replace(/\.git$/, ''))
const openFolder = () => app.run(() => window.api.openPath(app.repoDir!))
function review() {
    const b = app.toReview[0]
    if (b) app.dialog = { kind: 'review', branch: b.name }
}
</script>

<template>
    <div class="facts">
        <span class="fact" :class="{ draft: app.onDraft }" title="作業中（現行版か改定案）">
            <UIcon :name="app.onDraft ? 'i-lucide-git-branch' : 'i-lucide-badge-check'" />{{ app.currentBranch?.label ??
                '現行版' }}
        </span>
        <span class="fact url" :title="app.repo?.url ?? 'ローカル だけで管理しています'">
            <UIcon :name="remote ? 'i-lucide-cloud' : 'i-lucide-laptop'" />{{ remote ?? 'ローカル だけ' }}
        </span>
        <span class="fact">
            <UIcon name="i-lucide-file-text" />{{ app.docs.length }} 文書<template v-if="folders">・{{ folders }}
                ディレクトリ</template>
        </span>
        <UPopover v-if="unsaved.length" :content="{ align: 'start', side: 'bottom' }">
            <button class="fact warn">
                <UIcon name="i-lucide-circle-dot" />未保存 {{ unsaved.length }}
            </button>
            <template #content>
                <div class="pop">
                    <p class="cd-muted">版として保存していない変更があります</p>
                    <button v-for="d in unsaved" :key="d.path" class="item" :title="d.path"
                        @click="app.openDoc(d.path)">
                        <UIcon name="i-lucide-file-pen" />{{ d.title }}
                    </button>
                </div>
            </template>
        </UPopover>
        <button v-if="app.toReview.length" class="fact primary" @click="review">
            <UIcon name="i-lucide-user-check" />あなたの確認待ち {{ app.toReview.length }}
        </button>
        <UTooltip text="フォルダを開く">
            <UButton icon="i-lucide-folder-open" size="xs" color="neutral" variant="ghost" aria-label="フォルダを開く"
                @click="openFolder" />
        </UTooltip>
        <UTooltip text="このリポジトリの設定">
            <UButton icon="i-lucide-settings-2" size="xs" color="neutral" variant="ghost" aria-label="このリポジトリの設定"
                @click="app.view = 'repo'" />
        </UTooltip>
    </div>
</template>

<style scoped>
.facts {
    display: flex;
    align-items: center;
    gap: 2px 12px;
    flex-wrap: wrap;
    min-width: 0;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.fact {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.fact.url {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    display: inline-block;
}

.fact.url :deep(svg) {
    vertical-align: -2px;
    margin-right: 4px;
}

.fact.draft {
    color: var(--cd-draft);
    font-weight: 600;
}

button.fact {
    cursor: pointer;
    padding: 0 6px;
    border-radius: 999px;
}

.fact.warn {
    color: var(--ui-color-warning-600);
    background: color-mix(in oklab, var(--ui-color-warning-500) 12%, transparent);
}

.fact.primary {
    color: var(--ui-color-primary-600);
    background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
}

.pop {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 320px;
    font-size: 13px;
}

.pop p {
    font-size: 12px;
    margin: 0 4px 4px;
}

.item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
}

.item:hover {
    background: var(--ui-bg-elevated);
}
</style>
