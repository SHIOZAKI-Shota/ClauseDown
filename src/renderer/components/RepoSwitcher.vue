<script setup lang="ts">
import { useApp } from '~/stores/app'

const app = useApp()
const open = ref(false)
const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'
watch(open, (v) => v && app.checkRepos())

const groups = computed(() => [
    {
        id: 'repos',
        items: (app.settings?.repos ?? []).map((r) => ({
            label: r.name,
            suffix: missing(r.dir) ? '見つかりません' : r.url || r.dir,
            icon: missing(r.dir) ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive',
            active: r.dir === app.repoDir,
            onSelect: () => {
                open.value = false
                app.switchRepo(r.dir)
            },
        })),
    },
    {
        id: 'manage',
        items: [
            ...(app.repoDir
                ? [
                    {
                        label: 'リポジトリホーム',
                        icon: 'i-lucide-layout-grid',
                        onSelect: () => {
                            open.value = false
                            app.goRepoHome()
                        },
                    },
                    {
                        label: 'このリポジトリの設定',
                        icon: 'i-lucide-settings-2',
                        onSelect: () => {
                            open.value = false
                            app.view = 'repo'
                        },
                    },
                ]
                : []),
            {
                label: 'リポジトリの追加・管理',
                icon: 'i-lucide-plus',
                onSelect: () => {
                    open.value = false
                    app.openSettings('setup', 'repos')
                },
            },
        ],
    },
])
const title = computed(() => [`リポジトリ：${app.repo?.name ?? '未選択'}`, app.repo?.dir ?? '', '（押すと切り替え）'].filter(Boolean).join('\n'))
</script>

<template>
    <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
        <button class="cd-crumb-btn repo" :class="{ open }" :title="title" aria-label="リポジトリを切り替える">
            <UIcon name="i-lucide-archive" class="ci" />
            <span class="nm">{{ app.repo?.name ?? 'リポジトリを選ぶ' }}</span>
            <UIcon name="i-lucide-chevron-down" class="caret" />
        </button>
        <template #content>
            <UCommandPalette :groups="groups" placeholder="リポジトリを検索" class="palette" />
        </template>
    </UPopover>
</template>

<style scoped>
.palette {
    width: 360px;
    max-height: 60vh;
}
</style>
