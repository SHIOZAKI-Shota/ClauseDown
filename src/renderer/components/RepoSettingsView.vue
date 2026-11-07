<script setup lang="ts">
import type { RepoRules } from '@shared/api'
import { FORGE_LABEL } from '@shared/forge'
import { inheritedStyle, type StyleOverride } from '@shared/folder-style'
import { allFolders } from '~/utils/folders'
import { useApp } from '~/stores/app'
import { sameJson, toPlain } from '~/utils/ipc'
import { useSavedFlash } from '~/composables/useSavedFlash'
import { useDebounced } from '~/composables/useDebounced'

const app = useApp()

const SECTIONS = [
    { id: 'basic', label: '基本', icon: 'i-lucide-archive' },
    { id: 'style', label: '印刷・PDF・Word の書式', icon: 'i-lucide-type' },
    { id: 'rules', label: '承認の決まり', icon: 'i-lucide-shield-check' },
    { id: 'kinds', label: '期日の種類', icon: 'i-lucide-calendar-cog' },
    { id: 'forge', label: 'GitHub/GitLab', icon: 'i-lucide-cloud' },
]
const { saved, flash } = useSavedFlash()
const publishing = ref(false)
const changing = ref(false)
const disconnecting = ref(false)

const repoName = ref(app.repo?.name ?? '')
watch(
    repoName,
    useDebounced(async () => {
        const v = repoName.value.trim()
        if (!v || !app.settings) return
        const repos = app.settings.repos.map((r) => (r.dir === app.repoDir ? { ...r, name: v } : r))
        await app.saveSettings({ ...app.settings, repos })
        flash()
    }, 500),
)
const openFolder = () => app.repoDir && window.api.openPath(app.repoDir)
const openUrl = (u: string) => window.api.openExternal(u)
const removeRepo = () => app.repoDir && app.forgetRepo(app.repoDir)

const webUrl = computed(() => app.repo?.url?.replace(/.git$/, ''))
const account = computed(() => {
    const url = app.repo?.url
    if (!url) return undefined
    return [...app.accounts].sort((a, b) => b.base.length - a.base.length).find((a) => url.startsWith(a.base + '/'))
})
async function disconnect() {
    disconnecting.value = false
    await app.disconnectRemote()
}

const folder = ref('')
const ROOT = '/'
const folderSel = computed({ get: () => folder.value || ROOT, set: (v: string) => (folder.value = v === ROOT ? '' : v) })
const FOLDERS = computed(() => [
    { label: 'リポジトリ全体', value: ROOT, icon: 'i-lucide-archive' },
    ...allFolders(app.docs).filter(Boolean).map((f) => ({ label: f, value: f, icon: 'i-lucide-folder' })),
])
const inherited = computed(() => inheritedStyle(app.prefs.docStyle, app.styleLayers, folder.value))
const override = ref<StyleOverride>({})
watch([folder, () => app.styleLayers], () => (override.value = { ...(app.styleLayers[folder.value] ?? {}) }), { immediate: true })
const scopeName = computed(() => (folder.value ? 'このディレクトリ' : 'このリポジトリ'))

const saveStyle = useDebounced(async () => {
    const f = folder.value
    const next = toPlain<StyleOverride>(override.value)
    if (sameJson(next, app.styleLayers[f] ?? {})) return
    const committed = await app.run(() => window.api.saveFolderStyle(app.repoDir!, f, next))
    if (committed === undefined) return
    app.styleLayers = { ...app.styleLayers, [f]: next }
    flash()
    if (committed && app.prefs.pushOnSave && app.repo?.url) void app.sync()
    else if (committed) void app.refreshDocs()
}, 900)
function onStyle(v: StyleOverride) {
    override.value = v
    saveStyle()
}

const rules = reactive<RepoRules>({ ...app.rules, approvers: [...app.rules.approvers] })
watch(() => app.rules, (r) => Object.assign(rules, { ...r, approvers: [...r.approvers] }))
watch(
    rules,
    useDebounced(async () => {
        const next = toPlain<RepoRules>(rules)
        if (sameJson(next, app.rules)) return
        await app.run(() => window.api.saveRules(app.repoDir!, next))
        await app.refreshDocs()
        flash()
    }, 600),
    { deep: true },
)
</script>

<template>
    <SettingsLayout :sections="SECTIONS" :title="app.repo?.name ?? ''" scope="このリポジトリ"
        note="書式・承認の決まり・期日の種類は、このリポジトリの中に記録され、使う人全員に共有されます。" :saved="saved" id-prefix="r" stacked-head>
        <SettingsSection id="basic" title="基本">
            <SettingRow label="表示名" description="タイトルバーのリポジトリの切り替えに出る名前です。ローカル の中だけの名前で、ほかの人には影響しません。">
                <UInput v-model="repoName" class="cd-w-input" />
            </SettingRow>
            <SettingRow label="フォルダ" :description="app.repoDir ?? ''">
                <UButton label="フォルダを開く" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline"
                    @click="openFolder" />
            </SettingRow>
            <SettingRow label="一覧から外す" description="ローカル の一覧から外すだけで、フォルダや版は消えません。">
                <UButton label="一覧から外す" size="sm" color="error" variant="outline" @click="removeRepo" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="style" title="印刷・PDF・Word の書式">
            <SettingRow label="設定する範囲" description="ディレクトリごとに変えられます。変えていない項目は、上（リポジトリ全体 → ローカル の設定）の設定を使用します。">
                <USelect v-model="folderSel" :items="FOLDERS" class="cd-w-input" />
            </SettingRow>
            <StyleEditor :model-value="override" :inherited="inherited.style" :from="inherited.from"
                :scope-name="scopeName" @update:model-value="onStyle" />
            <p class="muted">
                書式は {{ folder ? `「${folder}」ディレクトリ` : 'リポジトリの直下' }}の設定ファイルに記録され、変えると「書式を変更」という版が自動で保存されます。
                <template v-if="app.onDraft">今は改定案「{{ app.currentBranch?.label
                    }}」を開いているので、この案の中だけが変わります（現行版に反映すると、現行版でも使われます）。</template>
            </p>
        </SettingsSection>

        <SettingsSection id="rules" title="承認の決まり">
            <SettingRow label="現行版に反映する前に承認を必須にする" description="改定案は「確認を依頼」で承認を受けるまで、現行版に反映できなくなります。">
                <USwitch v-model="rules.requireApproval" />
            </SettingRow>
            <SettingRow label="承認できる人"
                description="空欄なら、依頼した人以外の誰でも承認できます。GitHub・GitLab のユーザー名は「@yamada」のように @ を付けて入れてください（リモートでの承認もこれで判定します）。@ を付けないものは、ログインしていない人の手入力の名前と照合します。"
                stacked>
                <UInputTags v-model="rules.approvers" placeholder="@ユーザー名 または 名前 を入れて Enter" class="cd-full" />
                <p v-if="app.identity?.login" class="muted">あなたは「@{{ app.identity.login }}」です。</p>
            </SettingRow>
            <p v-if="app.forge" class="muted">
                確認依頼は {{ app.forgeLabel }} にも作られます。詳しくは「GitHub/GitLab」のタブを見てください。
            </p>
        </SettingsSection>

        <SettingsSection id="kinds" title="期日の種類">
            <p class="muted">施行・公布・提出・届出・契約の更新など、期日に付ける種類です。このリポジトリを使う全員に共有されます。</p>
            <EventKindsEditor @saved="flash" />
        </SettingsSection>

        <SettingsSection id="forge" title="GitHub/GitLab">
            <template v-if="app.repo?.url">
                <SettingRow label="リモート" :description="webUrl ?? ''">
                    <UBadge v-if="app.forge" :label="`${app.forgeLabel} と連携`" color="success" variant="subtle"
                        :icon="app.forge === 'gitlab' ? 'i-lucide-gitlab' : 'i-lucide-github'" />
                    <UButton :label="app.forge ? `${FORGE_LABEL[app.forge]}で開く` : 'ブラウザで開く'"
                        icon="i-lucide-external-link" size="sm" color="neutral" variant="outline"
                        @click="webUrl && openUrl(webUrl)" />
                </SettingRow>
                <SettingRow label="ログイン"
                    :description="account?.login ? `${account.label} に ${account.login} でログインしています。` : account ? `${account.label} にログインしていません。同期や確認依頼の前にログインしてください。` : 'このサーバーはログインの一覧にありません。社内の GitLab なら、アプリの設定で追加してください。'">
                    <UButton label="アプリの設定を開く" icon="i-lucide-log-in" size="sm" color="neutral" variant="outline"
                        @click="app.openSettings('setup', 'remote')" />
                </SettingRow>
                <SettingRow label="リモートを変更" description="GitHub・GitLab でリポジトリの名前や持ち主を変えたときに、新しい URL を入れます。">
                    <UButton label="変更…" icon="i-lucide-pencil" size="sm" color="neutral" variant="outline"
                        @click="changing = true" />
                </SettingRow>
                <SettingRow label="リモートから外す" description="ローカル だけで管理する形に戻します。リモートのリポジトリと、ローカル の版は消えません。">
                    <UButton label="外す…" icon="i-lucide-unlink" size="sm" color="error" variant="outline"
                        @click="disconnecting = true" />
                </SettingRow>
                <p v-if="app.forge === 'github'" class="muted">
                    リモートが GitHub なので、確認依頼は GitHub のプルリクエストとしても作られます。GitHub の「ブランチ保護」で承認を必須にすると、アプリの外から現行版を変える操作も止められます。
                </p>
                <p v-else-if="app.forge === 'gitlab'" class="muted">
                    リモートが GitLab なので、確認依頼は GitLab のマージリクエストとしても作られ、承認・コメントも GitLab に残ります。GitLab
                    の「保護ブランチ」や承認ルールを使うと、アプリの外から現行版を変える操作も止められます。
                </p>
            </template>
            <template v-else>
                <SettingRow label="リモート"
                    description="ローカル（ローカル だけで管理しています）。GitHub・GitLab に送信すると、ほかの人と共有でき、確認依頼や納品の記録も残せます。">
                    <UButton label="リモートを追加…" icon="i-lucide-cloud-upload" size="sm" @click="publishing = true" />
                </SettingRow>
            </template>
        </SettingsSection>
    </SettingsLayout>
    <PublishRepoModal v-if="publishing" v-model:open="publishing" />
    <ChangeRemoteModal v-if="changing" v-model:open="changing" />
    <ConfirmModal v-model:open="disconnecting" title="リモートから外す" confirm-label="外す" color="error"
        :description="`リモート（${webUrl ?? ''}）とのつながりを外し、ローカル だけで管理する形に戻します。リモートのリポジトリと、ローカル の版は消えません。`"
        @confirm="disconnect" />
</template>

<style scoped>
.muted {
    font-size: 12px;
    color: var(--ui-text-muted);
    line-height: 1.7;
}

code {
    font-size: 11px;
}
</style>
