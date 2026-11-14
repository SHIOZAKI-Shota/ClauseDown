<script setup lang="ts">
import { useApp } from '~/stores/app'

const app = useApp()
const emit = defineEmits<{ search: [] }>()
const demo = isDemo()
const inDoc = computed(() => ['editor', 'history', 'compare', 'releases'].includes(app.view))
function backToDoc() {
    if (app.currentDoc && !inDoc.value) app.openDoc(app.currentDoc.path, app.lastDocView)
}
</script>

<template>
    <header class="titlebar" :class="{ mac: IS_MAC && !demo }">
        <button class="brand" title="初期ページへ" aria-label="ClauseDown（初期ページへ）" @click="app.view = 'home'">
            <BrandLogo class="logo" />
        </button>

        <nav class="crumbs" aria-label="今いる場所">
            <RepoSwitcher v-if="app.settings?.repos.length" />
            <template v-if="app.repoDir && app.currentBranch">
                <UIcon name="i-lucide-chevron-right" class="sep" />
                <BranchMenu />
            </template>
            <template v-if="app.repoDir && app.currentDoc">
                <UIcon name="i-lucide-chevron-right" class="sep" />
                <button
                    class="cd-crumb-btn doc"
                    :class="{ here: inDoc }"
                    :aria-current="inDoc ? 'page' : undefined"
                    :title="inDoc ? app.currentDoc.path : `「${app.currentDoc.title}」に戻る`"
                    @click="backToDoc"
                >
                    <UIcon name="i-lucide-file-text" class="ci" />
                    <span class="nm">{{ app.currentDoc.title }}</span>
                </button>
            </template>
        </nav>

        <button class="search" @click="emit('search')">
            <UIcon name="i-lucide-search" />
            <span class="txt">文書・条・操作を検索</span>
            <span class="kbd">{{ IS_MAC ? '⌘K' : 'Ctrl K' }}</span>
        </button>
        <span class="cd-grow" />
        <div class="right">
            <DemoActions v-if="demo" />
            <SyncStatus v-else />
            <ThemeToggle variant="ghost" size="xs" />
        </div>
    </header>
</template>

<style scoped>
.titlebar {
    /* drag の中のボタンは no-drag にしないと押せない */
    -webkit-app-region: drag;
    position: fixed;
    inset: 0 0 auto 0;
    height: 40px;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 14px;
    padding-left: 12px;
    /* 窓のボタンは OS が描くので、Window Controls Overlay の領域の分を空ける */
    padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px);
    background: var(--cd-titlebar);
    color: var(--cd-titlebar-text);
    border-bottom: 1px solid var(--ui-border);
    font-size: 12px;
    user-select: none;
}

.titlebar.mac {
    padding-left: calc(env(titlebar-area-x, 80px) + 8px);
}

.brand {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 8px;
    margin-left: -4px;
    border-radius: 7px;
    cursor: pointer;
    color: var(--cd-brand);
}

.brand:hover {
    background: var(--ui-bg);
}

.logo {
    height: 15px;
    width: auto;
    display: block;
}

.crumbs {
    --search-half: 190px;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: calc(50vw - var(--search-half) - 140px);
    white-space: nowrap;
}

.crumbs :deep(.cd-crumb-btn.repo) {
    flex-shrink: 6;
    min-width: 56px;
}

.crumbs :deep(.cd-crumb-btn.branch) {
    flex-shrink: 0;
    max-width: 200px;
}

.crumbs .cd-crumb-btn.doc {
    flex-shrink: 3;
    min-width: 56px;
}

.cd-crumb-btn.doc:not(.here) {
    opacity: 0.6;
}

.cd-crumb-btn.doc.here .nm {
    font-weight: 600;
}

.sep {
    width: 12px;
    height: 12px;
    opacity: 0.45;
    flex-shrink: 0;
}

.search {
    -webkit-app-region: no-drag;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    width: 360px;
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg);
    color: var(--ui-text-muted);
    font-size: 12px;
    cursor: pointer;
}

.search:hover {
    border-color: var(--ui-border-accented);
    color: var(--ui-text);
}

.search .txt {
    flex: 1;
    text-align: left;
}

.right {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
}

.kbd {
    font-size: 10px;
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 0 5px;
}

@media (max-width: 1500px) {
    .search {
        width: 240px;
    }

    .crumbs {
        --search-half: 130px;
    }
}

@media (max-width: 1240px) {
    .search {
        width: 32px;
        padding: 0;
        justify-content: center;
    }

    .search .txt,
    .search .kbd {
        display: none;
    }

    .crumbs {
        --search-half: 16px;
    }
}
</style>
