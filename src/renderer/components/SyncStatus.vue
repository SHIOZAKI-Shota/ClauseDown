<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { FORGE_LABEL } from '@shared/forge'
import { useApp } from '~/stores/app'

const app = useApp()
const showConflicts = ref(false)
const publishing = ref(false)
const changing = ref(false)
const disconnecting = ref(false)

const local = computed(() => app.syncState?.state === 'local' || !app.repo?.url)
const status = computed(() => {
    const s = app.syncState
    const remote = (text: string, color: 'success' | 'warning' | 'error' | 'neutral', title: string) => ({
        text: text ? `リモート・${text}` : 'リモート',
        icon: 'i-lucide-cloud',
        color,
        title,
    })
    if (!app.repo?.url) return { text: 'ローカル', icon: 'i-lucide-hard-drive', color: 'neutral' as const, title: 'リモートがなく、ローカル だけで管理しています' }
    if (!s) return { text: '未確認', icon: 'i-lucide-circle-help', color: 'neutral' as const, title: 'まだ同期していません' }
    switch (s.state) {
        case 'local':
            return { text: 'ローカル', icon: 'i-lucide-hard-drive', color: 'neutral' as const, title: 'リモートがなく、ローカル だけで管理しています' }
        case 'upToDate': return remote('', 'success', `リモート（${app.repo?.url ?? ''}）と同じ、最新の状態です`)
        case 'behind': return remote('', 'success', 'リモートから最新の版を取得しました')
        case 'ahead': return remote(`送信待ち ${s.count}`, 'warning', `リモートにまだ送信していない版が ${s.count} 件あります`)
        case 'diverged': return remote('重なりあり', 'error', 'リモートの変更と重なっています')
        case 'dirty': return remote('取得できません', 'warning', '保存していない変更があるため、最新を取得できません')
        case 'error': return remote('同期できませんでした', 'error', s.message)
    }
})

const diverged = computed(() => app.syncState?.state === 'diverged')

async function doSync() {
    const s = await app.sync()
    if (s?.state === 'diverged') showConflicts.value = true
}
function main() {
    if (local.value) publishing.value = true
    else if (diverged.value) showConflicts.value = true
    else void doSync()
}

const webUrl = computed(() => app.repo?.url?.replace(/\.git$/, ''))
const where = computed(() => (app.forge ? FORGE_LABEL[app.forge] : 'ブラウザ'))
async function copyUrl() {
    if (!webUrl.value) return
    await navigator.clipboard.writeText(webUrl.value)
    app.notify('リモートの URL をコピーしました')
}

const menu = computed<DropdownMenuItem[][]>(() =>
    local.value
        ? [
            [{ type: 'label', label: 'ローカル だけで管理しています' }],
            [{ label: 'リモートを追加…', icon: 'i-lucide-cloud-upload', onSelect: () => (publishing.value = true) }],
            [{ label: 'GitHub/GitLab のログイン', icon: 'i-lucide-log-in', onSelect: () => app.openSettings('setup', 'remote') }],
        ]
        : [
            ...(webUrl.value ? [[{ type: 'label' as const, label: webUrl.value.replace(/^https?:\/\//, '') }]] : []),
            [
                diverged.value
                    ? { label: '重なりを解決…', icon: 'i-lucide-git-merge', onSelect: () => (showConflicts.value = true) }
                    : { label: '今すぐ同期', icon: 'i-lucide-refresh-cw', disabled: app.busy, onSelect: () => void doSync() },
                { label: `${where.value}で開く`, icon: 'i-lucide-external-link', onSelect: () => webUrl.value && window.api.openExternal(webUrl.value) },
                { label: 'URL をコピー', icon: 'i-lucide-copy', onSelect: () => void copyUrl() },
            ],
            [
                { label: 'リモートを変更…', icon: 'i-lucide-pencil', onSelect: () => (changing.value = true) },
                { label: 'GitHub/GitLab の設定', icon: 'i-lucide-settings-2', onSelect: () => app.openSettings('repo', 'forge') },
            ],
            [{ label: 'リモートから外す…', icon: 'i-lucide-unlink', color: 'error', onSelect: () => (disconnecting.value = true) }],
        ],
)

async function disconnect() {
    disconnecting.value = false
    await app.disconnectRemote()
}

const synced = new Set<string>()
watch(
    () => (app.repoDir && !app.repoProblem ? app.repoDir : null),
    (dir) => {
        if (!dir || synced.has(dir)) return
        synced.add(dir)
        if (app.prefs.syncOnStart) void doSync()
    },
    { immediate: true },
)
</script>

<template>
    <div v-if="app.repoDir && !app.repoProblem" class="sync">
        <div class="pill" :class="`c-${status.color}`">
            <UButton :label="status.text" :icon="status.icon" :color="status.color" variant="soft" size="xs"
                class="seg main"
                :trailing-icon="local ? 'i-lucide-plus' : diverged ? 'i-lucide-git-merge' : 'i-lucide-refresh-cw'"
                :ui="{ trailingIcon: app.busy && !local ? 'spin' : '' }" :disabled="app.busy && !local"
                :title="`${status.title}\n${local ? '押すと、リモートを追加します' : diverged ? '押すと、重なりを解決する画面を開きます' : '押すと同期します'}`"
                :aria-label="local ? 'リモートを追加' : diverged ? '重なりを解決する' : '同期する'" @click="main" />
            <UDropdownMenu :items="menu" :content="{ align: 'end' }">
                <UButton icon="i-lucide-chevron-down" :color="status.color" variant="soft" size="xs" class="seg more"
                    aria-label="リモートのメニュー" title="リモートのメニュー" />
            </UDropdownMenu>
        </div>
        <ConflictModal v-if="showConflicts && app.syncState?.state === 'diverged'" :state="app.syncState"
            @close="showConflicts = false" />
        <PublishRepoModal v-if="publishing" v-model:open="publishing" />
        <ChangeRemoteModal v-if="changing" v-model:open="changing" />
        <ConfirmModal v-model:open="disconnecting" title="リモートから外す" confirm-label="外す" color="error"
            :description="`リモート（${webUrl ?? ''}）とのつながりを外し、ローカル だけで管理する形に戻します。リモートのリポジトリと、ローカル の版は消えません。あとで「リモートを追加」からつなぎ直せます。`"
            @confirm="disconnect" />
    </div>
</template>

<style scoped>
.sync {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 4px;
}

.pill {
    display: inline-flex;
    align-items: stretch;
}

.seg.main {
    border-radius: 999px 0 0 999px;
}

.seg.more {
    border-radius: 0 999px 999px 0;
    padding-left: 4px;
    padding-right: 6px;
    margin-left: 1px;
}

.pill :deep(.spin) {
    animation: cd-spin 0.9s linear infinite;
}

@keyframes cd-spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
