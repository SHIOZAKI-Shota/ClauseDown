<script setup lang="ts">
import type { UpdateState } from '@shared/api'
import { AUTHOR } from '@shared/about'
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
    switch (u.state) {
        case 'checking':
            return '確認しています'
        case 'latest':
            return '最新のバージョンです'
        case 'available':
            return `バージョン ${u.version} があります${u.date ? `（${u.date}）` : ''}`
        case 'downloading':
            return `バージョン ${u.version} をダウンロードしています（${u.percent ?? 0}%）`
        case 'ready':
            return `バージョン ${u.version} の準備ができました`
        case 'error':
            return u.message ?? '更新でエラーが起きました'
        case 'dev':
            return '開発中のアプリでは更新を確認できません'
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
    <SettingsSection id="about" title="このソフトについて">
        <div class="hero">
            <BrandLogo class="logo" />
            <p class="cd-muted">バージョン {{ data?.app.version ?? '—' }}　© 2026</p>
        </div>
        <SettingRow label="更新" :description="status">
            <UButton v-if="update?.state === 'available' || (update?.state === 'error' && update.version)" :label="IS_MAC ? '配布ページを開く' : 'ダウンロード'"
                icon="i-lucide-download" size="sm" @click="download" />
            <UButton v-else-if="update?.state === 'ready'" label="再起動して更新" icon="i-lucide-rotate-cw" size="sm"
                @click="install" />
            <UButton v-else label="更新を確認" icon="i-lucide-refresh-cw" size="sm" color="neutral" variant="outline"
                :loading="busy" :disabled="busy || update?.state === 'dev'" @click="check" />
        </SettingRow>
        <UProgress v-if="update?.state === 'downloading'" :model-value="update.percent ?? 0" size="sm" class="progress" />
        <div v-if="update?.notes && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready')"
            class="notes">
            <p class="notes-head">バージョン {{ update.version }} の変更点</p>
            <pre>{{ update.notes }}</pre>
        </div>
        <SettingRow label="" :description="authorName">
            <UButton :label="site" icon="i-lucide-globe" size="sm" color="neutral" variant="outline"
                @click="openSite" />
            <UButton :label="email" icon="i-lucide-mail" size="sm" color="neutral" variant="outline"
                @click="openMail" />
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
