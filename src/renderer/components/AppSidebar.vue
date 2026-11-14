<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { useApp } from '~/stores/app'
import type { Pane } from '~/composables/usePane'

const app = useApp()

const OPTS = { size: 264, min: 220, max: 420 }
const FOOTER = 'p-0 flex-col items-stretch gap-0'
const collapsed = ref(false)
onMounted(() => nextTick(() => (collapsed.value = true)))
const stored = useStorage('clausedown-sidebar-side', { size: OPTS.size, collapsed: false })
const clamp = (px: number) => Math.round(Math.min(OPTS.max, Math.max(OPTS.min, px)))
const setSize = (px: number) => {
    stored.value = { ...stored.value, size: clamp(px) }
    collapsed.value = false
}
const sidePane: Pane = {
    state: stored,
    opts: OPTS,
    measure: ref(null),
    setSize,
    grow: (s = 48) => setSize((stored.value.size || OPTS.size) + s),
    shrink: (s = 48) => setSize((stored.value.size || OPTS.size) - s),
    reset: () => setSize(OPTS.size),
    collapse: () => (collapsed.value = true),
    expand: () => (collapsed.value = false),
    toggle: () => (collapsed.value = !collapsed.value),
}
const demo = isDemo()
const toggle = (to: 'setup' | 'about') => (app.view === to ? app.goBack() : (app.view = to))
</script>

<template>
    <UDashboardSidebar
        id="side"
        v-model:collapsed="collapsed"
        class="cd-side"
        :ui="
            collapsed
                ? { root: 'min-w-0', header: 'h-auto p-0', body: 'p-0 gap-0 overflow-hidden', footer: FOOTER }
                : { header: 'h-auto p-0', body: 'cd-side-body', footer: FOOTER }
        "
        resizable
        collapsible
        :collapsed-size="28"
        :default-size="OPTS.size"
        :min-size="OPTS.min"
        :max-size="OPTS.max"
    >
        <template #header>
            <div v-if="!collapsed" class="cd-pane-bar side-bar">
                <span class="cd-pane-title">リポジトリ</span>
                <PaneControls :pane="sidePane" side="left" label="サイドバー" />
            </div>
        </template>

        <button v-if="collapsed" class="rail" title="サイドバーを開く" aria-label="サイドバーを開く" @click="collapsed = false">
            <UIcon name="i-lucide-panel-left-open" />
            <span class="rail-label">リポジトリ</span>
        </button>

        <RepoList v-if="!collapsed" />

        <template #footer>
            <template v-if="collapsed">
                <UTooltip v-if="!demo" :text="app.view === 'about' ? 'このソフトについてを閉じる' : 'このソフトについて'">
                    <button
                        class="rail-btn"
                        :class="{ on: app.view === 'about' }"
                        :aria-label="app.view === 'about' ? 'このソフトについてを閉じる' : 'このソフトについて'"
                        @click="toggle('about')"
                    >
                        <UIcon :name="app.view === 'about' ? 'i-lucide-x' : 'i-lucide-info'" />
                    </button>
                </UTooltip>
                <UTooltip :text="app.view === 'setup' ? '設定を閉じる' : '設定'">
                    <button
                        class="rail-btn"
                        :class="{ on: app.view === 'setup' }"
                        :aria-label="app.view === 'setup' ? '設定を閉じる' : '設定'"
                        @click="toggle('setup')"
                    >
                        <UIcon :name="app.view === 'setup' ? 'i-lucide-x' : 'i-lucide-settings'" />
                    </button>
                </UTooltip>
            </template>
            <template v-else>
                <button v-if="!demo" class="nav-item footer-item" :class="{ on: app.view === 'about' }" @click="toggle('about')">
                    <UIcon :name="app.view === 'about' ? 'i-lucide-x' : 'i-lucide-info'" />
                    <span class="nl">{{ app.view === 'about' ? 'このソフトについてを閉じる' : 'このソフトについて' }}</span>
                </button>
                <button class="nav-item footer-item" :class="{ on: app.view === 'setup' }" @click="toggle('setup')">
                    <UIcon :name="app.view === 'setup' ? 'i-lucide-x' : 'i-lucide-settings'" />
                    <span class="nl">{{ app.view === 'setup' ? '設定を閉じる' : '設定' }}</span>
                    <span v-if="app.view !== 'setup'" class="who">{{ app.me || '名前未設定' }}</span>
                </button>
            </template>
        </template>
    </UDashboardSidebar>
</template>

<style scoped>
.cd-side {
    background: var(--cd-sidebar);
}

.side-bar {
    width: 100%;
    background: transparent;
    padding-left: 14px;
}

.rail {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 0;
    color: var(--ui-text-muted);
    cursor: pointer;
}

.rail:hover,
.rail-btn:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.rail-label {
    writing-mode: vertical-rl;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
}

.rail-btn {
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 8px 0;
    color: var(--ui-text-muted);
    border-top: 1px solid var(--ui-border);
    cursor: pointer;
}

.rail-btn.on {
    color: var(--ui-color-primary-500);
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--ui-text-toned);
    cursor: pointer;
    text-align: left;
}

.nl {
    flex: 1;
}

.nav-item:hover:not(:disabled) {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
}

.nav-item.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.nav-item.on :deep(svg) {
    color: var(--ui-color-primary-500);
}

.nav-item:disabled {
    opacity: 0.5;
    cursor: default;
}

.footer-item {
    border-top: 1px solid var(--ui-border);
    border-radius: 0;
    padding: 9px 14px;
}

.who {
    font-size: 11px;
    color: var(--ui-text-dimmed);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
}
</style>
