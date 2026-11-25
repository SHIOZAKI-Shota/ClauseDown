<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import type { RepoRules } from '@shared/api'
import { FORGE_LABEL } from '@shared/forge'
import { inheritedStyle, type StyleOverride } from '@shared/folder-style'
import { allFolders } from '~/utils/folders'
import { useApp } from '~/stores/app'
import { sameJson, toPlain } from '~/utils/ipc'
import { useSavedFlash } from '~/composables/useSavedFlash'
import { useDebounced } from '~/composables/useDebounced'
import { useT } from '~/composables/useT'
import { usePdfSign } from '~/composables/usePdfSign'

const app = useApp()
const t = useT()
const ask = useConfirm()

const SECTIONS = computed(() => [
    { id: 'basic', label: t.value.repo.settings.sections.basic, icon: 'i-lucide-archive' },
    { id: 'style', label: t.value.repo.settings.sections.style, icon: 'i-lucide-type' },
    { id: 'rules', label: t.value.repo.settings.sections.rules, icon: 'i-lucide-shield-check' },
    { id: 'kinds', label: t.value.repo.settings.sections.kinds, icon: 'i-lucide-calendar-cog' },
    { id: 'forge', label: 'GitHub/GitLab', icon: 'i-lucide-cloud' },
])
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
async function removeRepo() {
    if (
        app.repoDir &&
        (await ask({
            title: t.value.repo.removeFromList,
            description: t.value.repo.settings.removeDesc,
            confirmLabel: t.value.repo.removeFromList,
            color: 'error',
        }))
    )
        await app.forgetRepo(app.repoDir)
}

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
    { label: t.value.repo.settings.wholeRepo, value: ROOT, icon: 'i-lucide-archive' },
    ...allFolders(app.docs)
        .filter(Boolean)
        .map((f) => ({ label: f, value: f, icon: 'i-lucide-folder' })),
])
const inherited = computed(() => inheritedStyle(app.prefs.docStyle, app.styleLayers, folder.value))
const override = ref<StyleOverride>({})
watch([folder, () => app.styleLayers], () => (override.value = { ...app.styleLayers[folder.value] }), { immediate: true })
const scopeName = computed(() => (folder.value ? t.value.repo.settings.thisDir : t.value.repo.settings.thisRepo))

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

const pdfSign = usePdfSign()
const FOLLOW = '__default'
const repoCert = ref(FOLLOW)
const certOptions = computed(() => [
    { value: FOLLOW, label: t.value.signing.pdf.followDefault },
    ...pdfSign.certs.value.map((c) => ({ value: c.id, label: c.label || t.value.signing.pdf.kinds[c.kind] })),
])
onMounted(async () => {
    if (isDemo()) return
    const st = await pdfSign.load()
    repoCert.value = (app.repoDir && st?.signing.pdf.repoCerts[app.repoDir]) || FOLLOW
})
async function setRepoCert(v: string) {
    if (!app.repoDir) return
    repoCert.value = v
    if (await app.run(() => window.api.setRepoPdfCert(app.repoDir!, v === FOLLOW ? null : v))) flash()
}

const policySigned = ref(false)
async function exportSigners() {
    const out = await app.run(() => window.api.exportAllowedSigners(app.repoDir!))
    if (out) app.notifyExported(t.value.signing.policy.exported, out)
}
const rules = reactive<RepoRules>({ ...app.rules, approvers: [...app.rules.approvers] })
watch(
    () => app.rules,
    (r) => Object.assign(rules, { ...r, approvers: [...r.approvers] }),
)
watch(
    rules,
    useDebounced(async () => {
        const next = toPlain<RepoRules>(rules)
        if (policySigned.value || sameJson(next, app.rules)) return
        await app.run(() => window.api.saveRules(app.repoDir!, next))
        await app.refreshDocs()
        flash()
    }, 600),
    { deep: true },
)
</script>

<template>
    <SettingsLayout
        :sections="SECTIONS"
        :title="app.repo?.name ?? ''"
        :scope="t.repo.settings.thisRepo"
        :note="t.repo.settings.note"
        :saved="saved"
        id-prefix="r"
        stacked-head
    >
        <SettingsSection id="basic" :title="t.repo.settings.sections.basic">
            <SettingRow :label="t.repo.settings.displayName" :description="t.repo.settings.displayNameDesc">
                <UInput v-model="repoName" class="cd-w-input" />
            </SettingRow>
            <SettingRow :label="t.repo.settings.folder" :description="app.repoDir ?? ''">
                <UButton :label="t.repo.settings.openFolder" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="openFolder" />
            </SettingRow>
            <SettingRow v-if="pdfSign.certs.value.length > 1" :label="t.signing.pdf.repoCert" :description="t.signing.pdf.repoCertDesc">
                <USelect :model-value="repoCert" :items="certOptions" class="cd-w-input" @update:model-value="(v: string) => setRepoCert(v)" />
            </SettingRow>
            <SettingRow :label="t.repo.removeFromList" :description="t.repo.settings.removeDesc">
                <UButton :label="t.repo.removeFromList" size="sm" color="error" variant="outline" @click="removeRepo" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="style" :title="t.repo.settings.sections.style">
            <SettingRow :label="t.repo.settings.scope" :description="t.repo.settings.scopeDesc">
                <USelect v-model="folderSel" :items="FOLDERS" class="cd-w-input" />
            </SettingRow>
            <StyleEditor :model-value="override" :inherited="inherited.style" :from="inherited.from" :scope-name="scopeName" @update:model-value="onStyle" />
            <p class="muted">
                {{ t.repo.settings.styleNote(folder)
                }}<template v-if="app.onDraft">{{ t.repo.settings.styleDraftNote(app.currentBranch?.label ?? '') }}</template>
            </p>
        </SettingsSection>

        <SettingsSection id="rules" :title="t.repo.settings.sections.rules">
            <PolicyRules v-if="!isDemo()" @status="(st) => (policySigned = !!st?.signed)" />
            <SettingRow v-if="!isDemo()" :label="t.signing.policy.exportSigners" :description="t.signing.policy.exportSignersDesc">
                <UButton :label="t.signing.policy.exportButton" size="sm" color="neutral" variant="outline" icon="i-lucide-download" @click="exportSigners" />
            </SettingRow>
            <template v-if="!policySigned">
                <SettingRow :label="t.repo.settings.requireApproval" :description="t.repo.settings.requireApprovalDesc">
                    <USwitch v-model="rules.requireApproval" />
                </SettingRow>
                <SettingRow :label="t.signing.repo.requireSigned" :description="t.signing.repo.requireSignedDesc">
                    <USwitch v-model="rules.requireSignedApproval" :disabled="!rules.requireApproval" />
                </SettingRow>
                <SettingRow :label="t.repo.settings.approvers" :description="t.repo.settings.approversDesc" stacked>
                    <UInputTags v-model="rules.approvers" :placeholder="t.repo.settings.approversPlaceholder" class="cd-full" />
                    <p v-if="app.identity?.login" class="muted">{{ t.repo.settings.youAre(app.identity.login) }}</p>
                </SettingRow>
                <p v-if="app.forge" class="muted">{{ t.repo.settings.forgeReviewNote(app.forgeLabel) }}</p>
            </template>
        </SettingsSection>

        <SettingsSection id="kinds" :title="t.repo.settings.sections.kinds">
            <p class="muted">{{ t.repo.settings.kindsNote }}</p>
            <EventKindsEditor @saved="flash" />
        </SettingsSection>

        <SettingsSection id="forge" title="GitHub/GitLab">
            <template v-if="app.repo?.url">
                <SettingRow :label="t.repo.settings.remote" :description="webUrl ?? ''">
                    <UBadge
                        v-if="app.forge"
                        :label="t.repo.settings.linked(app.forgeLabel)"
                        color="success"
                        variant="subtle"
                        :icon="app.forge === 'gitlab' ? 'i-lucide-gitlab' : 'i-lucide-github'"
                    />
                    <UButton
                        :label="app.forge ? t.repo.settings.openIn(FORGE_LABEL[app.forge]) : t.repo.settings.openInBrowser"
                        icon="i-lucide-external-link"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="webUrl && openUrl(webUrl)"
                    />
                </SettingRow>
                <SettingRow
                    :label="t.repo.settings.login"
                    :description="
                        account?.login
                            ? t.repo.settings.loggedInAs(account.label, account.login)
                            : account
                              ? t.repo.settings.notLoggedIn(account.label)
                              : t.repo.settings.unknownServer
                    "
                >
                    <UButton
                        :label="t.repo.settings.openAppSettings"
                        icon="i-lucide-log-in"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="app.openSettings('setup', 'remote')"
                    />
                </SettingRow>
                <SettingRow :label="t.repo.settings.changeRemote" :description="t.repo.settings.changeRemoteDesc">
                    <UButton :label="t.repo.settings.change" icon="i-lucide-pencil" size="sm" color="neutral" variant="outline" @click="changing = true" />
                </SettingRow>
                <SettingRow :label="t.repo.settings.disconnect" :description="t.repo.settings.disconnectDesc">
                    <UButton
                        :label="t.repo.settings.disconnectButton"
                        icon="i-lucide-unlink"
                        size="sm"
                        color="error"
                        variant="outline"
                        @click="disconnecting = true"
                    />
                </SettingRow>
                <p v-if="app.forge === 'github'" class="muted">{{ t.repo.settings.githubNote }}</p>
                <p v-else-if="app.forge === 'gitlab'" class="muted">{{ t.repo.settings.gitlabNote }}</p>
            </template>
            <template v-else>
                <SettingRow :label="t.repo.settings.remote" :description="t.repo.settings.localOnly">
                    <UButton :label="t.repo.settings.addRemote" icon="i-lucide-cloud-upload" size="sm" @click="publishing = true" />
                </SettingRow>
            </template>
        </SettingsSection>
    </SettingsLayout>
    <PublishRepoModal v-if="publishing" v-model:open="publishing" />
    <ChangeRemoteModal v-if="changing" v-model:open="changing" />
    <ConfirmModal
        v-model:open="disconnecting"
        :title="t.repo.settings.disconnect"
        :confirm-label="t.repo.settings.disconnectConfirm"
        color="error"
        :description="t.repo.settings.disconnectConfirmDesc(webUrl ?? '')"
        @confirm="disconnect"
    />
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
