<script setup lang="ts">
import type { ForgeAccount, ForgeLogin } from '@shared/api'
import { GITHUB_APP } from '@shared/about'
import { GITLAB_BASE } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ account: ForgeAccount }>()
const app = useApp()
const t = useT()
const f = computed(() => t.value.settings.forge)

const a = computed(() => props.account)
const github = computed(() => a.value.kind === 'github')
const selfHosted = computed(() => a.value.kind === 'gitlab' && a.value.base !== GITLAB_BASE)
const login = ref<ForgeLogin | null>(null)

const description = computed(() => {
    if (a.value.login) return a.value.method === 'app' ? f.value.signedInAs(a.value.login) : f.value.byToken(a.value.login)
    if (github.value) return f.value.githubHint
    if (a.value.deviceLogin) return f.value.deviceHint
    return f.value.oauthHint
})

async function startLogin() {
    const info = await app.run(() => window.api.loginStart(a.value.base))
    if (!info) return
    login.value = info
    const acc = await app.run(() => window.api.loginWait(a.value.base))
    login.value = null
    if (acc) {
        await app.refreshAccounts()
        app.notify(f.value.signedIn(a.value.label, acc.login ?? ''))
    }
}
async function logout() {
    await app.run(() => window.api.logout(a.value.base))
    await app.refreshAccounts()
}
const installApp = () => window.api.openExternal(GITHUB_APP.installUrl)
async function copyCode() {
    if (!login.value) return
    await navigator.clipboard.writeText(login.value.userCode)
    app.notify(f.value.codeCopied)
}

const token = ref('')
const showToken = ref(false)
const clientId = ref(
    github.value
        ? (app.settings?.githubClientId ?? '')
        : selfHosted.value
          ? (app.settings?.gitlabHosts?.find((h) => h.url === a.value.base)?.clientId ?? '')
          : (app.settings?.gitlabClientId ?? ''),
)
const username = ref(app.settings?.username ?? 'x-access-token')
const showAdvanced = ref(!!clientId.value || a.value.method === 'token' || (!a.value.login && !a.value.deviceLogin))

async function saveToken() {
    const ok = await app.runOk(() => window.api.setToken(a.value.base, token.value.trim()), f.value.tokenSaved)
    if (ok) {
        token.value = ''
        await app.refreshAccounts()
    }
}
async function saveIds() {
    const s = app.settings!
    const id = clientId.value.trim() || undefined
    const next = github.value
        ? { ...s, githubClientId: id, username: username.value.trim() || 'x-access-token' }
        : selfHosted.value
          ? { ...s, gitlabHosts: (s.gitlabHosts ?? []).map((h) => (h.url === a.value.base ? { url: h.url, clientId: id } : h)) }
          : { ...s, gitlabClientId: id }
    await app.run(() => app.saveSettings(next), f.value.idsSaved)
    await app.refreshAccounts()
}
async function removeHost() {
    await app.run(() => window.api.logout(a.value.base))
    const s = app.settings!
    await app.saveSettings({ ...s, gitlabHosts: (s.gitlabHosts ?? []).filter((h) => h.url !== a.value.base) })
    await app.refreshAccounts()
}
</script>

<template>
    <div class="forge">
        <SettingRow :label="a.label" :description="description">
            <UButton v-if="a.login" :label="f.logout" size="sm" color="neutral" variant="outline" @click="logout" />
            <UButton
                v-else-if="a.deviceLogin"
                :label="f.login"
                :icon="github ? 'i-lucide-github' : 'i-lucide-gitlab'"
                size="sm"
                :loading="!!login"
                @click="startLogin"
            />
        </SettingRow>
        <div v-if="login" class="code-box">
            <span>{{ f.enterCode }}</span>
            <span class="code">{{ login.userCode }}</span>
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="outline" :label="t.settings.copy" @click="copyCode" />
        </div>
        <SettingRow v-if="github" :label="f.install" :description="f.installDesc">
            <UButton :label="f.installButton" icon="i-lucide-external-link" size="sm" color="neutral" variant="outline" @click="installApp" />
        </SettingRow>
        <button class="adv-toggle" @click="showAdvanced = !showAdvanced">
            <UIcon :name="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />{{ f.advanced }}
        </button>
        <template v-if="showAdvanced">
            <SettingRow :label="f.token" :description="github ? f.tokenGithubDesc : f.tokenGitlabDesc">
                <UInput v-model="token" :type="showToken ? 'text' : 'password'" class="cd-w-input" autocomplete="off" :placeholder="f.overwrite">
                    <template #trailing>
                        <UButton
                            :icon="showToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                            size="xs"
                            color="neutral"
                            variant="link"
                            @click="showToken = !showToken"
                        />
                    </template>
                </UInput>
                <UButton :label="t.common.save" size="sm" color="neutral" variant="outline" :disabled="!token" @click="saveToken" />
            </SettingRow>
            <SettingRow
                :label="github ? f.githubClientId : f.oauthAppId"
                :description="github ? f.clientIdGithubDesc : selfHosted ? f.clientIdSelfHostedDesc : f.clientIdDesc"
            >
                <UInput v-model="clientId" class="cd-w-input" :placeholder="github ? 'Iv23li…' : ''" @change="saveIds" />
            </SettingRow>
            <SettingRow v-if="github" :label="f.username" :description="f.usernameDesc">
                <UInput v-model="username" class="cd-w-small" @change="saveIds" />
            </SettingRow>
            <SettingRow v-if="selfHosted" :label="f.removeHost" :description="f.removeHostDesc">
                <UButton :label="f.remove" size="sm" color="error" variant="outline" @click="removeHost" />
            </SettingRow>
        </template>
    </div>
</template>

<style scoped>
.forge {
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--ui-border);
}

.forge:last-of-type {
    border-bottom: 0;
}

.adv-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 6px 0 4px;
    font-size: 12px;
    color: var(--ui-text-muted);
    cursor: pointer;
}

.adv-toggle:hover {
    color: var(--ui-text);
}

.code-box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    margin: 4px 0 8px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    font-size: 12px;
}

.code {
    font-family: monospace;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.15em;
}
</style>
