<script setup lang="ts">
import { ja } from '@nuxt/ui/locale'
import { useApp } from '~/stores/app'
import { cssFont } from '@shared/prefs'
import { LEGAL_CSS } from '@shared/legal-css'

const app = useApp()

watchEffect(() => {
    const root = document.documentElement
    const p = app.prefs
    const s = app.style
    root.style.setProperty('--cd-ed-font', cssFont(p.editorFont, 'mono'))
    root.style.setProperty('--cd-ed-size', `${p.editorFontSize}px`)
    root.style.setProperty('--cd-font', cssFont(s.font))
    root.style.setProperty('--cd-size', `${s.fontSize}pt`)
    root.style.setProperty('--cd-line', String(s.lineHeight))
    root.style.setProperty('--cd-margin', `${s.margin}mm`)
    root.classList.toggle('cd-no-linenums', !p.lineNumbers)
    root.classList.toggle('cd-no-hints', !p.numberHints)
    const legal = document.getElementById('cd-legal-css')
    if (legal) legal.textContent = p.typesetCss || LEGAL_CSS
})
const colorMode = useColorMode()
const opening = ref(true)

onMounted(async () => {
    await app.load()
    const theme = app.settings?.theme ?? 'system'
    if (colorMode.preference !== theme) colorMode.preference = theme
})

defineShortcuts({
    meta_k: { handler: () => (app.paletteOpen = true), usingInput: true },
})
</script>

<template>
    <UApp :locale="ja" :toaster="{ position: 'bottom-center' }">
        <TitleBar @search="app.paletteOpen = true" />
        <UDashboardGroup v-if="app.settings" unit="px" storage="local" storage-key="clausedown" class="cd-group">
            <AppSidebar />
            <UDashboardPanel id="main">
                <div class="main">
                    <TopBar v-if="app.repoDir && !app.repoProblem && app.view !== 'home'" />
                    <BranchBanner v-if="app.repoDir && !app.repoProblem && app.view !== 'home'" />
                    <div class="content">
                        <HomeView v-if="app.view === 'home'" />
                        <SetupView v-else-if="app.view === 'setup'" />
                        <AboutView v-else-if="app.view === 'about'" />
                        <RepoMissing v-else-if="app.repoProblem && app.repo" :repo="app.repo" :state="app.repoProblem" />
                        <RepoSettingsView v-else-if="app.view === 'repo'" />
                        <DocListView v-else-if="app.view === 'docs'" />
                        <ScheduleView v-else-if="app.view === 'schedule'" :key="'s' + app.repoDir" />
                        <IssuesView v-else-if="app.view === 'issues'" :key="'i' + app.repoDir" />
                        <template v-else-if="app.currentPath">
                            <EditorView v-if="app.view === 'editor'" :key="app.currentPath + '@' + app.reloadKey" />
                            <HistoryView v-else-if="app.view === 'history'" :key="'h' + app.currentPath + '@' + app.reloadKey" />
                            <CompareView v-else-if="app.view === 'compare'" :key="'c' + app.currentPath + '@' + app.reloadKey" />
                            <ReleasesView v-else-if="app.view === 'releases'" :key="'r' + app.currentPath + '@' + app.reloadKey" />
                        </template>
                    </div>
                </div>
            </UDashboardPanel>
        </UDashboardGroup>

        <CommandPalette v-model:open="app.paletteOpen" />
        <NewDocModal v-if="app.dialog?.kind === 'newDoc'" :folder="app.dialog.folder" @close="app.dialog = null" />
        <NewBranchModal v-if="app.dialog?.kind === 'newBranch'" :from="app.dialog.from" @close="app.dialog = null" />
        <MergeModal v-if="app.dialog?.kind === 'merge'" :from="app.dialog.from" :into="app.dialog.into" @close="app.dialog = null" />
        <NewEventModal v-if="app.dialog?.kind === 'newEvent'" :doc-path="app.dialog.docPath" :date="app.dialog.date" @close="app.dialog = null" />
        <ReviewModal v-if="app.dialog?.kind === 'review'" :branch="app.dialog.branch" @close="app.dialog = null" />
        <OpeningSplash v-if="opening" @done="opening = false" />
        <HouritsuModal v-if="app.dialog?.kind === 'houritsu'" :dir="app.dialog.dir" :paths="app.dialog.paths" @close="app.dialog = null" />
    </UApp>
</template>

<style scoped>
.main {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
}

.content {
    flex: 1;
    min-height: 0;
    overflow: auto;
}
</style>

<style>
/* UDashboardGroup は画面いっぱいに広がるので、タイトルバーの下から始める */
.cd-group {
    top: 40px !important;
}

/* Nuxt UI の枠は min-h-svh なので、そのままではタイトルバーの分だけはみ出す */
.cd-group > * {
    min-height: 0 !important;
    height: 100%;
}

.cd-palette {
    max-width: 640px !important;
}
</style>
