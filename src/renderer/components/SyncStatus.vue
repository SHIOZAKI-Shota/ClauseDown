<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { FORGE_LABEL } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const showConflicts = ref(false)
const publishing = ref(false)
const changing = ref(false)
const disconnecting = ref(false)

const local = computed(() => app.syncState?.state === 'local' || !app.repo?.url)
const status = computed(() => {
    const s = app.syncState
    const m = t.value.sync.status
    const remote = (text: string, color: 'success' | 'warning' | 'error' | 'neutral', title: string) => ({
        text: text ? m.remoteWith(text) : m.remote,
        icon: 'i-lucide-cloud',
        color,
        title,
    })
    if (!app.repo?.url) return { text: m.local, icon: 'i-lucide-hard-drive', color: 'neutral' as const, title: m.localTitle }
    if (!s) return { text: m.unknown, icon: 'i-lucide-circle-help', color: 'neutral' as const, title: m.unknownTitle }
    switch (s.state) {
        case 'local':
            return { text: m.local, icon: 'i-lucide-hard-drive', color: 'neutral' as const, title: m.localTitle }
        case 'upToDate':
            return remote('', 'success', m.upToDateTitle(app.repo?.url ?? ''))
        case 'behind':
            return remote('', 'success', m.behindTitle)
        case 'ahead':
            return remote(m.ahead(s.count), 'warning', m.aheadTitle(s.count))
        case 'diverged':
            return remote(m.diverged, 'error', m.divergedTitle)
        case 'dirty':
            return remote(m.dirty, 'warning', m.dirtyTitle)
        case 'error':
            return remote(m.error, 'error', s.message)
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
const where = computed(() => (app.forge ? FORGE_LABEL[app.forge] : t.value.sync.status.browser))
async function copyUrl() {
    if (!webUrl.value) return
    await app.copy(webUrl.value, t.value.sync.status.urlCopied)
}

const menu = computed<DropdownMenuItem[][]>(() => {
    const m = t.value.sync.status
    return local.value
        ? [
              [{ type: 'label', label: m.localOnly }],
              [{ label: m.addRemote, icon: 'i-lucide-cloud-upload', onSelect: () => (publishing.value = true) }],
              [{ label: m.forgeLogin, icon: 'i-lucide-log-in', onSelect: () => app.openSettings('setup', 'remote') }],
          ]
        : [
              ...(webUrl.value ? [[{ type: 'label' as const, label: webUrl.value.replace(/^https?:\/\//, '') }]] : []),
              [
                  diverged.value
                      ? { label: m.resolve, icon: 'i-lucide-git-merge', onSelect: () => (showConflicts.value = true) }
                      : { label: m.syncNow, icon: 'i-lucide-refresh-cw', disabled: app.busy, onSelect: () => void doSync() },
                  { label: m.openIn(where.value), icon: 'i-lucide-external-link', onSelect: () => webUrl.value && window.api.openExternal(webUrl.value) },
                  { label: m.copyUrl, icon: 'i-lucide-copy', onSelect: () => void copyUrl() },
              ],
              [
                  { label: m.changeRemote, icon: 'i-lucide-pencil', onSelect: () => (changing.value = true) },
                  { label: m.forgeSettings, icon: 'i-lucide-settings-2', onSelect: () => app.openSettings('repo', 'forge') },
              ],
              [{ label: m.disconnect, icon: 'i-lucide-unlink', color: 'error', onSelect: () => (disconnecting.value = true) }],
          ]
})

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
            <UButton
                :label="status.text"
                :icon="status.icon"
                :color="status.color"
                variant="soft"
                size="xs"
                class="seg main"
                :trailing-icon="local ? 'i-lucide-plus' : diverged ? 'i-lucide-git-merge' : 'i-lucide-refresh-cw'"
                :ui="{ trailingIcon: app.busy && !local ? 'cd-spin' : '' }"
                :disabled="app.busy && !local"
                :title="`${status.title}\n${local ? t.sync.status.hintAdd : diverged ? t.sync.status.hintResolve : t.sync.status.hintSync}`"
                :aria-label="local ? t.sync.status.ariaAdd : diverged ? t.sync.status.ariaResolve : t.sync.status.ariaSync"
                @click="main"
            />
            <UDropdownMenu :items="menu" :content="{ align: 'end' }">
                <UButton
                    icon="i-lucide-chevron-down"
                    :color="status.color"
                    variant="soft"
                    size="xs"
                    class="seg more"
                    :aria-label="t.sync.status.menu"
                    :title="t.sync.status.menu"
                />
            </UDropdownMenu>
        </div>
        <ConflictModal v-if="showConflicts && app.syncState?.state === 'diverged'" :state="app.syncState" @close="showConflicts = false" />
        <PublishRepoModal v-if="publishing" v-model:open="publishing" />
        <ChangeRemoteModal v-if="changing" v-model:open="changing" />
        <ConfirmModal
            v-model:open="disconnecting"
            :title="t.sync.status.disconnectTitle"
            :confirm-label="t.sync.status.disconnectConfirm"
            color="error"
            :description="t.sync.status.disconnectDesc(webUrl ?? '')"
            @confirm="disconnect"
        />
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
</style>
