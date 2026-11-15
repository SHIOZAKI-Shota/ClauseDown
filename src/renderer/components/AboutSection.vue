<script setup lang="ts">
import type { UpdateState } from '@shared/api'
import { AUTHOR, PROJECT, manualUrl } from '@shared/about'
import { useApp } from '~/stores/app'

const { data } = useLicenses()
const authorName = `${AUTHOR.name} with Claude Code`
const site = AUTHOR.url.replace('https://', '')
const email = AUTHOR.email

function openSite() {
    void window.api.openExternal(AUTHOR.url)
}
function openMail() {
    void window.api.openExternal(`mailto:${AUTHOR.email}`)
}
const open = (url: string) => void window.api.openExternal(url)

const app = useApp()
const t = useT()
const update = ref<UpdateState | null>(null)
let off: (() => void) | undefined
onMounted(async () => {
    off = window.api.onUpdateState((s) => (update.value = s))
    update.value = await window.api.updateState()
})
onBeforeUnmount(() => off?.())

const busy = computed(() => update.value?.state === 'checking' || update.value?.state === 'downloading')
const status = computed(() => {
    const u = update.value
    if (!u) return ''
    const m = t.value.shell.about
    switch (u.state) {
        case 'checking':
            return m.checking
        case 'latest':
            return m.latest
        case 'available':
            return m.available(u.version, u.date, u.via === 'brew')
        case 'downloading':
            return m.downloading(u.version, u.percent ?? 0)
        case 'ready':
            return u.via === 'brew' ? m.readyBrew(u.version) : m.ready(u.version)
        case 'error':
            return u.message ?? m.error
        case 'dev':
            return m.dev
        default:
            return ''
    }
})
const check = async () => (update.value = await window.api.checkUpdate())
const download = async () => (update.value = await window.api.downloadUpdate())
async function install() {
    await app.flushEditor()
    await window.api.installUpdate()
}
</script>

<template>
    <SettingsSection id="about" :title="t.common.aboutApp">
        <div class="hero">
            <BrandLogo class="logo" />
            <p class="cd-muted">{{ t.shell.about.version(data?.app.version ?? '—') }}　© 2026</p>
        </div>
        <SettingRow :label="t.shell.about.update" :description="status">
            <UButton
                v-if="update?.state === 'available' || (update?.state === 'error' && update.version)"
                :label="update.via === 'brew' ? t.shell.update.updateNow : IS_MAC ? t.shell.update.openDownloadPage : t.shell.update.download"
                icon="i-lucide-download"
                size="sm"
                @click="download"
            />
            <UButton v-else-if="update?.state === 'ready'" :label="t.shell.update.restartToUpdate" icon="i-lucide-rotate-cw" size="sm" @click="install" />
            <UButton
                v-else
                :label="t.shell.about.checkUpdate"
                icon="i-lucide-refresh-cw"
                size="sm"
                color="neutral"
                variant="outline"
                :loading="busy"
                :disabled="busy || update?.state === 'dev'"
                @click="check"
            />
        </SettingRow>
        <UProgress v-if="update?.state === 'downloading'" :model-value="update.percent ?? 0" size="sm" class="progress" />
        <div v-if="update?.notes && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready')" class="notes">
            <p class="notes-head">{{ t.shell.about.notesHead(update.version) }}</p>
            <pre>{{ update.notes }}</pre>
        </div>
        <SettingRow :label="t.shell.about.checkOnStart" :description="t.shell.about.checkOnStartDesc">
            <USwitch :model-value="app.prefs.checkUpdateOnStart" @update:model-value="(v: boolean) => app.setPrefs({ checkUpdateOnStart: v })" />
        </SettingRow>
        <SettingRow :label="t.shell.about.links">
            <UButton :label="t.shell.about.manual" icon="i-lucide-book-open" size="sm" color="neutral" variant="outline" @click="open(manualUrl(app.locale))" />
            <UButton label="GitHub" icon="i-lucide-github" size="sm" color="neutral" variant="outline" @click="open(PROJECT.repo)" />
        </SettingRow>
        <SettingRow label="" :description="authorName">
            <UButton :label="site" icon="i-lucide-globe" size="sm" color="neutral" variant="outline" @click="openSite" />
            <UButton :label="email" icon="i-lucide-mail" size="sm" color="neutral" variant="outline" @click="openMail" />
        </SettingRow>
        <LicenseList />
    </SettingsSection>
</template>

<style scoped>
.hero {
    padding: 16px 0 8px;
}

.logo {
    height: 32px;
    width: auto;
    color: var(--cd-brand);
}

.progress {
    margin: 4px 0 12px;
}

.notes {
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-bg-elevated);
}

.notes-head {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
}

.notes pre {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.7;
    color: var(--ui-text-toned);
}

.hero p {
    margin: 10px 0 0;
    font-size: 13px;
}

.sources {
    padding: 12px 0 4px;
    font-size: 13px;
    line-height: 1.8;
}

.sources h3 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
}

.sources p {
    margin: 0 0 8px;
    color: var(--ui-text-muted);
}

.sources a {
    color: var(--ui-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
}
</style>
