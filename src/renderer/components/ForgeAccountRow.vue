<script setup lang="ts">
import type { ForgeAccount, ForgeLogin } from '@shared/api'
import { GITHUB_APP } from '@shared/about'
import { GITLAB_BASE } from '@shared/forge'
import { useApp } from '~/stores/app'

const props = defineProps<{ account: ForgeAccount }>()
const app = useApp()

const a = computed(() => props.account)
const github = computed(() => a.value.kind === 'github')
const selfHosted = computed(() => a.value.kind === 'gitlab' && a.value.base !== GITLAB_BASE)
const login = ref<ForgeLogin | null>(null)

const description = computed(() => {
    if (a.value.login) return a.value.method === 'app' ? `${a.value.login} としてログインしています` : `アクセストークンで接続しています（${a.value.login}）`
    if (github.value) return 'ClauseDown の GitHub App でログインすると、許可したリポジトリだけに必要な権限で接続できます'
    if (a.value.deviceLogin) return 'ブラウザで GitLab にログインして接続します'
    return 'ブラウザでのログインには OAuth アプリの登録が必要です。それまでは「詳しい設定」でアクセストークンを入力してください'
})

async function startLogin() {
    const info = await app.run(() => window.api.loginStart(a.value.base))
    if (!info) return
    login.value = info
    const acc = await app.run(() => window.api.loginWait(a.value.base))
    login.value = null
    if (acc) {
        await app.refreshAccounts()
        app.notify(`${a.value.label} に ${acc.login ?? ''} としてログインしました`)
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
    app.notify('コードをコピーしました')
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
    const ok = await app.runOk(() => window.api.setToken(a.value.base, token.value.trim()), 'アクセストークンを保存しました')
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
    await app.run(() => app.saveSettings(next), '接続の設定を保存しました')
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
            <UButton v-if="a.login" label="ログアウト" size="sm" color="neutral" variant="outline" @click="logout" />
            <UButton
                v-else-if="a.deviceLogin"
                label="ログイン"
                :icon="github ? 'i-lucide-github' : 'i-lucide-gitlab'"
                size="sm"
                :loading="!!login"
                @click="startLogin"
            />
        </SettingRow>
        <div v-if="login" class="code-box">
            <span>ブラウザに次のコードを入力してください</span>
            <span class="code">{{ login.userCode }}</span>
            <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="outline" label="コピー" @click="copyCode" />
        </div>
        <SettingRow
            v-if="github"
            label="リポジトリへのインストール"
            description="ClauseDown の GitHub App を、アカウント（または Organization）の使うリポジトリにインストールします。リポジトリごとに、最初に一度だけ必要です。リポジトリを増やしたときも、ここから追加してください。"
        >
            <UButton label="インストールする" icon="i-lucide-external-link" size="sm" color="neutral" variant="outline" @click="installApp" />
        </SettingRow>
        <button class="adv-toggle" @click="showAdvanced = !showAdvanced">
            <UIcon :name="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />詳しい設定（管理者向け）
        </button>
        <template v-if="showAdvanced">
            <SettingRow
                label="アクセストークン"
                :description="
                    github
                        ? 'GitHub App を使わない場合に入力します。'
                        : 'GitLab の「アクセストークン」で作ったものを入力します。スコープは api・read_repository・write_repository を選んでください。'
                "
            >
                <UInput v-model="token" :type="showToken ? 'text' : 'password'" class="cd-w-input" autocomplete="off" placeholder="入力すると上書きします">
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
                <UButton label="保存" size="sm" color="neutral" variant="outline" :disabled="!token" @click="saveToken" />
            </SettingRow>
            <SettingRow
                :label="github ? 'GitHub App の Client ID' : 'OAuth アプリの Application ID'"
                :description="
                    github
                        ? '自分で登録した GitHub App を使うときだけ入力します。空欄なら ClauseDown の App を使用します。'
                        : selfHosted
                          ? 'GitLab の管理者が登録した OAuth アプリ（Confidential はオフ、Device authorization grant はオン）の Application ID。入れるとブラウザでログインできます。'
                          : '自分で登録した OAuth アプリを使うときだけ入力します。'
                "
            >
                <UInput v-model="clientId" class="cd-w-input" :placeholder="github ? 'Iv23li…' : ''" @change="saveIds" />
            </SettingRow>
            <SettingRow v-if="github" label="ユーザー名" description="通常は変更しません（既定は x-access-token）。">
                <UInput v-model="username" class="cd-w-small" @change="saveIds" />
            </SettingRow>
            <SettingRow v-if="selfHosted" label="このサーバーを外す" description="ログインの情報も消えます。リポジトリのフォルダはそのまま残ります。">
                <UButton label="外す" size="sm" color="error" variant="outline" @click="removeHost" />
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
