<script setup lang="ts">
import { groupRepos } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { repoSectionItems } from '~/composables/useRepoSectionMenu'

const app = useApp()
const open = ref(false)
const missing = (dir: string) => (app.repoStates[dir] ?? 'ok') !== 'ok'
watch(open, (v) => v && app.checkRepos())

const groups = computed(() => [
    ...groupRepos(app.settings?.repos ?? []).map((g) => ({
        id: `repos:${g.section}`,
        ...(g.section ? { label: g.section } : {}),
        items: g.repos.map((r) => ({
            label: r.name,
            suffix: missing(r.dir) ? '見つかりません' : r.url || r.dir,
            icon: missing(r.dir) ? 'i-lucide-folder-x' : r.url ? 'i-lucide-cloud' : 'i-lucide-hard-drive',
            active: r.dir === app.repoDir,
            onSelect: () => {
                open.value = false
                app.switchRepo(r.dir)
            },
        })),
    })),
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
const moveOpen = ref(false)
const moveItems = computed(() =>
    app.repoDir
        ? repoSectionItems(app.repoDir).map((g) =>
            g.map((it) => ({
                ...it,
                onSelect: (e: Event) => {
                    open.value = false
                    it.onSelect?.(e)
                },
            })),
        )
        : [],
)
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
            <UCommandPalette :groups="groups" placeholder="リポジトリを検索" class="palette" @mouseenter="moveOpen = false" />
            <UDropdownMenu v-if="app.repoDir" v-model:open="moveOpen" :modal="false" :items="moveItems"
                :content="{ side: 'right', align: 'end', sideOffset: 4 }" size="sm">
                <button class="move" :class="{ on: moveOpen }" @mouseenter="moveOpen = true" @click="moveOpen = true">
                    <UIcon name="i-lucide-folder-input" class="mi" />
                    <span class="ml">セクションの移動</span>
                    <UIcon name="i-lucide-chevron-right" class="mi" />
                </button>
            </UDropdownMenu>
        </template>
    </UPopover>
</template>

<style scoped>
.palette {
    width: 360px;
    max-height: 60vh;
}

.move {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 12px;
    border-top: 1px solid var(--ui-border);
    font-size: 14px;
    text-align: left;
    color: var(--ui-text);
    cursor: pointer;
}

.move:hover,
.move.on {
    background: var(--ui-bg-elevated);
}

.ml {
    flex: 1;
}

.mi {
    width: 18px;
    height: 18px;
    color: var(--ui-text-dimmed);
}
</style>
