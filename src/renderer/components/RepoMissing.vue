<script setup lang="ts">
import type { RepoEntry, RepoState } from '@shared/api'
import { useApp } from '~/stores/app'

const props = defineProps<{ repo: RepoEntry; state: RepoState; compact?: boolean }>()
const app = useApp()
const checking = ref(false)

const title = computed(() =>
    props.state === 'missing' ? `リポジトリ「${props.repo.name}」のフォルダが見つかりません` : `「${props.repo.name}」のフォルダがリポジトリになっていません`,
)
const reasons = computed(() =>
    props.state === 'missing'
        ? ['フォルダの名前が変わったか、別の場所に移動された', 'フォルダが削除された', 'USB メモリやネットワークのドライブがつながっていない']
        : ['版管理の情報（.git フォルダ）が消えた', '別のフォルダと入れ替わった'],
)

async function retry() {
    checking.value = true
    try {
        await app.checkRepos()
        if (app.repoStates[props.repo.dir] === 'ok') {
            if (props.repo.dir === app.repoDir) await app.refreshDocs()
            app.notify('リポジトリが見つかりました')
        } else app.notify('まだ見つかりません', true)
    } finally {
        checking.value = false
    }
}
</script>

<template>
    <div class="missing" :class="{ compact }">
        <UIcon name="i-lucide-folder-x" class="big" />
        <h2>{{ title }}</h2>
        <p class="path">{{ repo.dir }}</p>
        <div class="why">
            <p>考えられる理由</p>
            <ul>
                <li v-for="r in reasons" :key="r">{{ r }}</li>
            </ul>
        </div>
        <div class="actions">
            <UButton label="新しい場所を選ぶ" icon="i-lucide-folder-search" @click="app.relocateRepo(repo.dir)" />
            <UButton label="もう一度確かめる" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="checking" @click="retry" />
            <UButton label="一覧から外す" color="error" variant="ghost" @click="app.forgetRepo(repo.dir)" />
        </div>
        <p v-if="repo.url" class="cd-muted hint">リモート（{{ repo.url }}）に版を送信してあれば、設定の「リポジトリを追加する」で取得し直すこともできます。</p>
    </div>
</template>

<style scoped>
.missing {
    max-width: 640px;
    margin: 48px auto;
    padding: 0 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
}

.missing.compact {
    margin: 0;
    padding: 0;
    max-width: none;
}

.big {
    width: 40px;
    height: 40px;
    color: var(--ui-color-warning-500);
}

h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 0;
}

.path {
    font-family: var(--cd-ed-font);
    font-size: 12px;
    color: var(--ui-text-muted);
    margin: 0;
    word-break: break-all;
}

.why {
    font-size: 13px;
    color: var(--ui-text-toned);
}

.why p {
    margin: 4px 0;
    font-weight: 600;
}

.why ul {
    margin: 0;
    padding-left: 20px;
    line-height: 1.8;
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
}

.hint {
    margin-top: 4px;
}
</style>
