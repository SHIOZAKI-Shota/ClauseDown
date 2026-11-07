<script setup lang="ts">
import { knownBases, normalizeBase } from '@shared/forge'
import { useApp } from '~/stores/app'

const app = useApp()
const host = ref('')
const appId = ref('')
const ok = computed(() => !!normalizeBase(host.value))

async function add() {
    const base = normalizeBase(host.value)
    const cur = app.settings
    if (!base || !cur) return
    if (knownBases(cur).some((b) => b.base === base)) {
        app.notify('このサーバーはすでに追加してあります', true)
        return
    }
    const id = appId.value.trim() || undefined
    const entry = id ? { url: base, clientId: id } : { url: base }
    await app.run(() => app.saveSettings({ ...cur, gitlabHosts: [...(cur.gitlabHosts ?? []), entry] }), 'GitLab のサーバーを追加しました')
    host.value = ''
    appId.value = ''
    await app.refreshAccounts()
}
</script>

<template>
    <h3>社内のGitLab</h3>
    <SettingRow label="GitLab の URL"
        description="例：https://gitlab.example.co.jp（https のみ）。追加すると、そのサーバーのリポジトリを取得したり、リモートとして使ったりできます。Application ID は、管理者が OAuth アプリを登録していれば入力します。"
        stacked>
        <div class="row">
            <UInput v-model="host" placeholder="https://gitlab.example.co.jp" class="cd-grow" />
            <UInput v-model="appId" placeholder="Application ID（任意）" class="cd-w-input" />
            <UButton label="追加" icon="i-lucide-plus" size="sm" :disabled="!ok" @click="add" />
        </div>
        <p v-if="host && !ok" class="warn">https:// で始まる URL を入力してください。</p>
    </SettingRow>
</template>

<style scoped>
h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 24px 0 0;
}

.row {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
}

.warn {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--ui-color-warning-600);
}
</style>
