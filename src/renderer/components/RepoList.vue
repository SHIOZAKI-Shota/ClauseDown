<script setup lang="ts">
import { useApp } from '~/stores/app'

const app = useApp()
const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'
onMounted(() => app.checkRepos())

function open(dir: string) {
    if (dir === app.repoDir) app.view = 'docs'
    else void app.switchRepo(dir)
}
</script>

<template>
    <div class="repos">
        <div class="head">
            <span>リポジトリ</span>
            <UButton
                icon="i-lucide-plus"
                size="xs"
                color="neutral"
                variant="ghost"
                title="リポジトリの追加・管理"
                @click="app.openSettings('setup', 'repos')"
            />
        </div>
        <div class="scroll">
            <button
                v-for="r in app.settings?.repos ?? []"
                :key="r.dir"
                class="repo"
                :class="{ on: r.dir === app.repoDir, missing: missing(r.dir) }"
                :title="[r.name, missing(r.dir) ? '見つかりません' : r.url || r.dir].join('\n')"
                @click="open(r.dir)"
            >
                <UIcon :name="missing(r.dir) ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive'" />
                <span class="nm">{{ r.name }}</span>
                <UBadge
                    v-if="r.dir === app.repoDir && app.toReview.length"
                    :label="`確認待ち ${app.toReview.length}`"
                    color="warning"
                    variant="subtle"
                    size="sm"
                />
            </button>
            <p v-if="!app.settings?.repos.length" class="empty">まだリポジトリがありません</p>
        </div>
    </div>
</template>

<style scoped>
.repos {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
    flex: 1;
    min-height: 0;
}

.head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ui-text-muted);
    padding-left: 4px;
}

.scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.repo {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--ui-text-toned);
    text-align: left;
    cursor: pointer;
}

.repo:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.repo.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.repo.on :deep(svg) {
    color: var(--ui-color-primary-500);
}

.repo.missing {
    color: var(--ui-text-dimmed);
}

.nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty {
    font-size: 12px;
    color: var(--ui-text-muted);
    padding: 4px;
    margin: 0;
}
</style>
