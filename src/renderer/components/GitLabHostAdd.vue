<script setup lang="ts">
import { knownBases, normalizeBase } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const host = ref('')
const appId = ref('')
const ok = computed(() => !!normalizeBase(host.value))

async function add() {
    const base = normalizeBase(host.value)
    const cur = app.settings
    if (!base || !cur) return
    if (knownBases(cur).some((b) => b.base === base)) {
        app.notify(t.value.settings.gitlab.exists, true)
        return
    }
    const id = appId.value.trim() || undefined
    const entry = id ? { url: base, clientId: id } : { url: base }
    await app.run(() => app.saveSettings({ ...cur, gitlabHosts: [...(cur.gitlabHosts ?? []), entry] }), t.value.settings.gitlab.added)
    host.value = ''
    appId.value = ''
    await app.refreshAccounts()
}
</script>

<template>
    <h3>{{ t.settings.gitlab.heading }}</h3>
    <SettingRow :label="t.settings.gitlab.url" :description="t.settings.gitlab.urlDesc" stacked>
        <div class="row">
            <UInput v-model="host" placeholder="https://gitlab.example.co.jp" class="cd-grow" />
            <UInput v-model="appId" :placeholder="t.settings.gitlab.appIdPlaceholder" class="cd-w-input" />
            <UButton :label="t.settings.add" icon="i-lucide-plus" size="sm" :disabled="!ok" @click="add" />
        </div>
        <p v-if="host && !ok" class="warn">{{ t.settings.gitlab.httpsOnly }}</p>
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
