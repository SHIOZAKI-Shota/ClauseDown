<script setup lang="ts">
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import { DEFAULT_MCP_PORT, type AiStatus, type DesktopStatus, type RepoEntry } from '@shared/api'
import { EXPERIMENTS, isEnabled, type ExperimentId } from '@shared/experiments'
import { DEFAULT_JOSHI_ALLOW, PROOFREAD_RULES, ruleOn } from '@shared/proofread-rules'
import { EDITOR_FONTS, cssFont, type AppPrefs } from '@shared/prefs'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import type { LanguagePref } from '@shared/i18n'
import { baseName } from '~/utils/folders'
import { useTheme, type ThemeMode } from '~/composables/useTheme'
import { useSavedFlash } from '~/composables/useSavedFlash'
import { useDebounced } from '~/composables/useDebounced'
import { FORGE_LABEL, knownBases, matchRemote } from '@shared/forge'
import { LEGAL_CSS } from '@shared/legal-css'
import { cleanSection, groupRepos, sectionNames } from '@shared/repo-sections'
const app = useApp()
const t = useT()
const { set: setTheme } = useTheme()

const demo = isDemo()
const DEMO_SECTIONS = ['display', 'editor', 'print']
const shown = (id: string) => !demo || DEMO_SECTIONS.includes(id)
const SECTION_ICONS = {
    profile: 'i-lucide-user',
    display: 'i-lucide-monitor',
    editor: 'i-lucide-square-pen',
    sync: 'i-lucide-refresh-cw',
    due: 'i-lucide-calendar-clock',
    export: 'i-lucide-download',
    signature: 'i-lucide-signature',
    print: 'i-lucide-type',
    remote: 'i-lucide-cloud',
    ai: 'i-lucide-sparkles',
    repos: 'i-lucide-archive',
    developer: 'i-lucide-code-xml',
} as const
const SECTIONS = computed(() =>
    (Object.keys(SECTION_ICONS) as (keyof typeof SECTION_ICONS)[])
        .filter((id) => shown(id))
        .map((id) => ({ id, label: t.value.settings.sections[id], icon: SECTION_ICONS[id] })),
)
const st = computed(() => t.value.settings)

const resetting = ref<'prefs' | 'all' | null>(null)
const resetBusy = ref(false)
async function resetPrefs() {
    resetBusy.value = true
    try {
        await app.resetPrefs()
        await setTheme('system')
        app.notify(st.value.developer.resetPrefsDone)
        resetting.value = null
    } finally {
        resetBusy.value = false
    }
}
async function resetAll() {
    resetBusy.value = true
    await app.run(() => window.api.resetAll())
    resetBusy.value = false
}

const { saved, flash } = useSavedFlash()
const proofreadRuleOn = (id: string) => ruleOn(id, app.prefs.proofreadRules)
const setProofreadRule = (id: string, on: boolean) => setPref('proofreadRules', { ...app.prefs.proofreadRules, [id]: on })
const joshiText = ref((app.prefs.proofreadJoshiAllow ?? DEFAULT_JOSHI_ALLOW).join('、'))
function saveJoshi() {
    const list = [
        ...new Set(
            joshiText.value
                .split(/[、,，\s]+/)
                .map((s) => s.trim())
                .filter(Boolean),
        ),
    ]
    joshiText.value = list.join('、')
    void setPref('proofreadJoshiAllow', list)
}
function resetJoshi() {
    joshiText.value = DEFAULT_JOSHI_ALLOW.join('、')
    void setPref('proofreadJoshiAllow', [...DEFAULT_JOSHI_ALLOW])
}
async function setPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) {
    await app.setPrefs({ [key]: value } as Partial<AppPrefs>)
    flash()
}

const signedIn = computed(() => app.accounts.filter((a) => a.login && a.name))
const profileUrl = (base: string, kind: string) =>
    kind === 'github' ? 'https://github.com/settings/profile' : `${base.replace(/\/+$/, '')}/-/user_settings/profile`
const openProfile = (base: string, kind: string) => void window.api.openExternal(profileUrl(base, kind))
const goLogin = () => (app.settingsTab.setup = 'remote')
const identityDefault = computed({
    get: () => app.settings?.identityDefault ?? 'auto',
    set: async (v: string) => {
        await app.saveSettings({ ...app.settings!, identityDefault: v === 'auto' ? undefined : v })
        flash()
    },
})
const defaultItems = computed(() => [
    { label: st.value.profile.auto, value: 'auto' },
    ...signedIn.value.map((a) => ({ label: st.value.profile.accountItem(a.label, a.name ?? '', a.login ?? ''), value: a.base })),
])
const nameSource = computed({
    get: () => (identityDefault.value === 'manual' ? 'manual' : 'login'),
    set: (v: 'login' | 'manual') => (identityDefault.value = v === 'manual' ? 'manual' : 'auto'),
})
const SOURCES = computed<SegmentItem[]>(() => [
    { value: 'login', label: st.value.profile.sourceLogin, icon: 'i-lucide-log-in' },
    { value: 'manual', label: st.value.profile.sourceManual, icon: 'i-lucide-pencil' },
])

const name = ref(app.settings?.author.name ?? '')
const email = ref(app.settings?.author.email ?? '')
watch(
    [name, email],
    useDebounced(async () => {
        await app.saveSettings({ ...app.settings!, author: { name: name.value.trim(), email: email.value.trim() } })
        flash()
    }, 500),
)

const theme = computed({
    get: () => app.settings?.theme ?? 'system',
    set: async (v: ThemeMode) => {
        await setTheme(v)
        flash()
    },
})
const SCALES = [90, 100, 110, 125].map((v) => ({ label: `${v}%`, value: v }))
const SIZES = Array.from({ length: 19 }, (_, i) => i + 10).map((v) => ({ label: `${v}px`, value: v }))

async function pickExportDir() {
    const d = await window.api.pickFolder()
    if (d) await setPref('exportDir', d)
}

const ai = ref<AiStatus | null>(null)
const mcpEnabled = ref(app.settings?.mcp?.enabled ?? false)
const mcpPort = ref(app.settings?.mcp?.port ?? DEFAULT_MCP_PORT)
const mcpToken = ref('')
const showMcpToken = ref(false)
const desktop = ref<DesktopStatus | null>(null)
const refreshDesktop = async () => (desktop.value = await window.api.desktopStatus().catch(() => null))
onMounted(async () => {
    if (demo) return
    ai.value = await window.api.aiStatus()
    if (mcpEnabled.value) mcpToken.value = await window.api.getMcpToken()
    void refreshDesktop()
})
const desktopText = computed(() => (desktop.value ? (desktop.value.error ?? st.value.mcp.desktopText[desktop.value.state]) : ''))
async function registerDesktop() {
    const s = await app.run(() => window.api.registerDesktop(), st.value.mcp.registerDone)
    if (s) desktop.value = s
}
async function unregisterDesktop() {
    const s = await app.run(() => window.api.unregisterDesktop(), st.value.mcp.unregisterDone)
    if (s) desktop.value = s
}
async function applyMcp() {
    const s = await app.run(() => window.api.setMcp({ enabled: mcpEnabled.value, port: Number(mcpPort.value) }))
    if (!s) return
    ai.value = s
    app.settings!.mcp = { enabled: mcpEnabled.value, port: Number(mcpPort.value) }
    if (mcpEnabled.value) mcpToken.value = await window.api.getMcpToken()
    if (s.mcp.error) app.notify(s.mcp.error, true)
    else flash()
}
async function regenerateToken() {
    const token = await app.run(() => window.api.regenerateMcpToken(), st.value.mcp.regenerated)
    if (token) mcpToken.value = token
}
const mcpUrl = computed(() => ai.value?.mcp.url || `http://127.0.0.1:${mcpPort.value}/mcp`)
const claudeCommand = computed(() => `claude mcp add --transport http clausedown ${mcpUrl.value} --header "Authorization: Bearer ${mcpToken.value}"`)
async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text)
    app.notify(st.value.copied(what))
}

const mode = ref<'new' | 'open' | 'clone'>('new')
const url = ref('')
const folderPath = ref('')
const folderPaths = ref<string[]>([])
const newName = ref('')
const adding = computed(() => app.busy)
const MODES = computed<SegmentItem<'new' | 'open' | 'clone'>[]>(() => [
    { value: 'new', label: st.value.repos.modes.new, icon: 'i-lucide-folder-plus' },
    { value: 'open', label: st.value.repos.modes.open, icon: 'i-lucide-folder-open' },
    { value: 'clone', label: st.value.repos.modes.clone, icon: 'i-lucide-cloud-download' },
])
watch(mode, () => {
    folderPath.value = ''
    folderPaths.value = []
    newName.value = ''
})
let nameFromUrl = ''
watch(url, (u) => {
    const guess = baseName(u.trim().replace(/\/+$/, '')).replace(/\.git$/, '')
    if (!newName.value || newName.value === nameFromUrl) newName.value = guess
    nameFromUrl = guess
})
const sepChar = computed(() => (folderPath.value.includes('\\') ? '\\' : '/'))
const nameError = computed(() => {
    const n = newName.value.trim()
    if (!n) return ''
    if (/[\\/:*?"<>|]/.test(n)) return st.value.repos.badChars
    if (n.startsWith('.') || n.endsWith('.') || n.endsWith(' ')) return st.value.repos.badDots
    return ''
})
const targetPath = computed(() =>
    folderPath.value && newName.value.trim() && !nameError.value ? `${folderPath.value.replace(/[\\/]+$/, '')}${sepChar.value}${newName.value.trim()}` : '',
)
const canAdd = computed(() => (mode.value === 'open' ? folderPaths.value.length > 0 : !!targetPath.value && (mode.value === 'new' || !!url.value.trim())))
async function pick() {
    if (mode.value === 'open') {
        const picked = await window.api.pickFolders()
        if (picked.length) folderPaths.value = picked
        return
    }
    const d = await window.api.pickFolder()
    if (d) folderPath.value = d
}

async function addOpenRepos() {
    const added: RepoEntry[] = []
    const notRepo: string[] = []
    const already: string[] = []
    await app.run(async () => {
        for (const dir of folderPaths.value) {
            if (app.settings!.repos.some((r) => r.dir === dir)) {
                already.push(baseName(dir))
                continue
            }
            const r = await window.api.openRepo(dir)
            if (r.ok) added.push({ name: baseName(dir), dir })
            else notRepo.push(baseName(dir))
        }
    })
    if (added.length) {
        const repos = [...app.settings!.repos, ...added]
        await app.saveSettings({ ...app.settings!, repos, current: added[0].dir })
        await app.refreshDocs()
        folderPaths.value = []
        for (const r of added) if (await checkHouritsu(r.dir)) break
    }
    const m = st.value.repos
    const notes = [notRepo.length ? m.notRepo(notRepo.join(m.listSep)) : '', already.length ? m.already(already.join(m.listSep)) : ''].filter(Boolean)
    if (added.length) app.notify(m.addedN(added.length))
    if (notes.length) app.notify(notes.join(m.noteSep), !added.length || notRepo.length > 0)
    if (added.length) app.view = 'docs'
}

async function addRepo() {
    if (mode.value === 'open') return addOpenRepos()
    const target = targetPath.value
    if (!canAdd.value || !target) return
    const ok = await app.runOk(async () => {
        if (mode.value === 'clone') await window.api.cloneRepo(url.value.trim(), target)
        else await window.api.initRepo(target)
    })
    if (!ok) return
    const entry: RepoEntry = { name: newName.value.trim(), dir: target, url: mode.value === 'clone' ? url.value.trim() : undefined }
    const repos = [...app.settings!.repos.filter((r) => r.dir !== target), entry]
    await app.saveSettings({ ...app.settings!, repos, current: target })
    await app.refreshDocs()
    url.value = ''
    folderPath.value = ''
    newName.value = ''
    app.notify(st.value.repos.created(entry.name, mode.value === 'clone'))
    app.view = 'docs'
    await checkHouritsu(target)
}
const removeRepo = (r: RepoEntry) => app.forgetRepo(r.dir)

async function checkHouritsu(dir: string): Promise<boolean> {
    const paths = await window.api.detectHouritsu(dir).catch(() => [] as string[])
    if (paths.length) app.dialog = { kind: 'houritsu', dir, paths }
    return paths.length > 0
}

const forgeOf = (r: RepoEntry) => (app.settings ? matchRemote(r.url, knownBases(app.settings)) : null)
const parentOf = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

const dupOf = ref<RepoEntry | null>(null)
const dupName = ref('')
const dupParent = ref('')
const dupBusy = ref(false)
function startDuplicate(r: RepoEntry) {
    dupOf.value = r
    dupName.value = `${r.name}${st.value.repos.copySuffix}`
    dupParent.value = parentOf(r.dir)
}
async function pickDupParent() {
    const d = await window.api.pickFolder()
    if (d) dupParent.value = d
}
async function duplicate() {
    const r = dupOf.value
    const name = dupName.value.trim()
    if (!r || !name || !dupParent.value) return
    if (r.dir === app.repoDir) await app.flushEditor()
    dupBusy.value = true
    const dest = await app.run(() => window.api.duplicateRepo(r.dir, dupParent.value, name))
    dupBusy.value = false
    if (!dest) return
    await app.saveSettings({ ...app.settings!, repos: [...app.settings!.repos, { name, dir: dest }] })
    dupOf.value = null
    app.notify(st.value.repos.duplicated(r.name, name))
}

const forkOf = ref<RepoEntry | null>(null)
const forkBusy = ref(false)
const forkWhere = computed(() => {
    const m = forkOf.value && forgeOf(forkOf.value)
    return m ? FORGE_LABEL[m.kind] : ''
})
async function fork() {
    const r = forkOf.value
    if (!r) return
    if (r.dir === app.repoDir) await app.flushEditor()
    forkBusy.value = true
    const url = await app.run(() => window.api.forkRepo(r.dir))
    forkBusy.value = false
    if (!url) return
    await app.setRepoUrl(r.dir, url)
    forkOf.value = null
    if (r.dir === app.repoDir) await app.refreshDocs()
    app.notify(st.value.repos.forked(url.replace(/\.git$/, '')))
}

const defaultCss = LEGAL_CSS.trim()
const typesetCss = ref(app.prefs.typesetCss || defaultCss)
const isDefaultCss = computed(() => typesetCss.value.trim() === defaultCss)
watch(
    typesetCss,
    useDebounced(async () => {
        await setPref('typesetCss', isDefaultCss.value || !typesetCss.value.trim() ? '' : typesetCss.value)
    }, 400),
)

const noSection = computed(() => st.value.repos.noSection)
const repoGroups = computed(() => groupRepos(app.settings?.repos ?? []))
const sectionChoices = computed(() => [noSection.value, ...sectionNames(app.settings?.repos ?? [])])
function setSection(r: RepoEntry, v: string) {
    const next = v === noSection.value ? undefined : cleanSection(v)
    if (next !== cleanSection(r.section)) void app.moveRepo(r.dir, { section: next })
}
const experimentOn = (id: ExperimentId) => isEnabled(app.settings, id)
async function setExperiment(id: ExperimentId, on: boolean) {
    const s = app.settings!
    await app.saveSettings({ ...s, experiments: { ...s.experiments, [id]: on } })
}
const libraryItems = computed(() => app.settings!.repos.map((r) => ({ label: r.name, value: r.dir })))
const libraryDir = computed(() => app.settings?.clauseLibrary)
async function setLibrary(dir: string) {
    await app.saveSettings({ ...app.settings!, clauseLibrary: dir })
}
const samplesBusy = ref(false)
async function addSamples() {
    const parent = await window.api.pickFolder()
    if (!parent) return
    samplesBusy.value = true
    const made = await app.run(() => window.api.createSamples(parent))
    samplesBusy.value = false
    if (!made) return
    const repos = [...app.settings!.repos.filter((r) => !made.some((m) => m.dir === r.dir)), ...made]
    await app.saveSettings({ ...app.settings!, repos })
    app.notify(st.value.developer.samplesAdded(made.length))
    const h = made.find((m) => m.name.startsWith('SAMPLE_houritsu'))
    if (h) await checkHouritsu(h.dir)
}
</script>

<template>
    <SettingsLayout :sections="SECTIONS" :title="t.settings.title" :scope="t.settings.scope" :note="t.settings.note" :saved="saved" id-prefix="s">
        <SettingsSection v-if="shown('profile')" id="profile" :title="t.settings.sections.profile">
            <UAlert
                v-if="app.repoDir && app.identity"
                color="neutral"
                variant="subtle"
                icon="i-lucide-user-check"
                :title="t.settings.profile.recordingAs(app.repo?.name ?? '', `${app.identity.name}${app.identity.email ? ` <${app.identity.email}>` : ''}`)"
                :description="t.settings.profile.nameOf(app.identity.label)"
            />
            <UAlert
                v-else-if="!app.identity"
                color="warning"
                variant="subtle"
                icon="i-lucide-user-x"
                :title="t.settings.profile.noName"
                :description="t.settings.profile.noNameDesc"
            />

            <SettingRow :label="t.settings.profile.nameSource" stacked>
                <SegmentSwitch v-model="nameSource" :items="SOURCES" :aria-label="t.settings.profile.nameSource" />
            </SettingRow>

            <template v-if="nameSource === 'login'">
                <SettingRow :label="t.settings.profile.accounts" :description="t.settings.profile.accountsDesc" stacked>
                    <div v-if="signedIn.length" class="accounts">
                        <div v-for="a in signedIn" :key="a.base" class="account">
                            <UIcon :name="a.kind === 'github' ? 'i-lucide-github' : 'i-lucide-gitlab'" class="kind" />
                            <div class="who">
                                <strong>{{ a.name }}</strong>
                                <span class="cd-muted"
                                    >@{{ a.login }}{{ t.common.sep }}{{ a.email || t.settings.profile.noEmail }}{{ t.common.sep }}{{ a.label }}</span
                                >
                            </div>
                            <UButton
                                :label="t.settings.profile.changeInProfile"
                                icon="i-lucide-external-link"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                @click="openProfile(a.base, a.kind)"
                            />
                        </div>
                    </div>
                    <div v-else class="accounts empty">
                        <span class="cd-muted">{{ t.settings.profile.notSignedIn }}</span>
                        <UButton :label="t.settings.profile.signIn" icon="i-lucide-log-in" size="sm" @click="goLogin" />
                    </div>
                </SettingRow>

                <SettingRow v-if="signedIn.length > 1" :label="t.settings.profile.defaultAccount" :description="t.settings.profile.defaultAccountDesc">
                    <USelect v-model="identityDefault" :items="defaultItems" class="cd-w-input" />
                </SettingRow>
            </template>

            <template v-else>
                <SettingRow :label="t.settings.profile.name" :description="t.settings.profile.nameDesc">
                    <UInput v-model="name" class="cd-w-input" :placeholder="t.settings.profile.namePlaceholder" />
                </SettingRow>
                <SettingRow :label="t.settings.profile.email" :description="t.settings.profile.emailDesc">
                    <UInput v-model="email" class="cd-w-input" placeholder="you@example.com" />
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection id="display" :title="t.settings.sections.display">
            <SettingRow :label="t.settings.language" :description="t.settings.languageDesc">
                <USelect
                    :model-value="app.prefs.language"
                    :items="(['system', 'ja', 'en'] as const).map((value) => ({ value, label: t.settings.languageOptions[value] }))"
                    class="cd-w-small"
                    @update:model-value="(v: LanguagePref) => setPref('language', v)"
                />
            </SettingRow>
            <SettingRow :label="t.settings.display.theme">
                <SegmentSwitch
                    v-model="theme"
                    :aria-label="t.settings.display.theme"
                    :items="[
                        { value: 'light', label: t.settings.display.light, icon: 'i-lucide-sun' },
                        { value: 'dark', label: t.settings.display.dark, icon: 'i-lucide-moon' },
                        { value: 'system', label: t.settings.display.system, icon: 'i-lucide-monitor' },
                    ]"
                />
            </SettingRow>
            <SettingRow :label="t.settings.display.uiScale">
                <USelect :model-value="app.prefs.uiScale" :items="SCALES" class="cd-w-small" @update:model-value="(v: number) => setPref('uiScale', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.display.reopenLastDoc">
                <USwitch :model-value="app.prefs.reopenLastDoc" @update:model-value="(v: boolean) => setPref('reopenLastDoc', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="editor" :title="t.settings.sections.editor">
            <SettingRow :label="t.settings.editor.font">
                <FontPicker
                    :model-value="app.prefs.editorFont"
                    :recommended="EDITOR_FONTS"
                    kind="mono"
                    class="cd-w-input"
                    @update:model-value="(v) => setPref('editorFont', v)"
                />
                <USelect
                    :model-value="app.prefs.editorFontSize"
                    :items="SIZES"
                    class="cd-w-small"
                    @update:model-value="(v: number) => setPref('editorFontSize', v)"
                />
            </SettingRow>
            <div class="sample" :style="{ fontFamily: cssFont(app.prefs.editorFont, 'mono'), fontSize: `${app.prefs.editorFontSize}px` }">
                ### 目的 {#purpose}<br />- この法律は、〇〇に関し必要な事項を定める。 0123456789 ABCabc
            </div>
            <SettingRow :label="t.settings.editor.lineNumbers">
                <USwitch :model-value="app.prefs.lineNumbers" @update:model-value="(v: boolean) => setPref('lineNumbers', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.editor.lineWrap">
                <USwitch :model-value="app.prefs.lineWrap" @update:model-value="(v: boolean) => setPref('lineWrap', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.editor.numberHints">
                <template #description>
                    {{ t.settings.editor.numberHintsBefore }}<span class="cd-hint cd-hint-article">第3条</span> <span class="cd-hint">２</span>
                    <span class="cd-hint">一</span>{{ t.settings.editor.numberHintsAfter }}
                </template>
                <USwitch :model-value="app.prefs.numberHints" @update:model-value="(v: boolean) => setPref('numberHints', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.editor.spellcheck" :description="t.settings.editor.spellcheckDesc">
                <USwitch :model-value="app.prefs.spellcheck !== false" @update:model-value="(v: boolean) => setPref('spellcheck', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.editor.proofread" :description="t.settings.editor.proofreadDesc">
                <USwitch :model-value="app.prefs.proofread" @update:model-value="(v: boolean) => setPref('proofread', v)" />
            </SettingRow>
            <template v-if="app.prefs.proofread">
                <SettingRow v-for="r in PROOFREAD_RULES" :key="r.id" :description="r.description" class="sub-row">
                    <template #label>{{ r.label }}</template>
                    <USwitch :model-value="proofreadRuleOn(r.id)" @update:model-value="(v: boolean) => setProofreadRule(r.id, v)" />
                </SettingRow>
                <SettingRow
                    v-if="proofreadRuleOn('no-doubled-joshi')"
                    :label="t.settings.editor.joshi"
                    class="sub-row"
                    :description="t.settings.editor.joshiDesc"
                >
                    <UInput v-model="joshiText" class="cd-w-input" @change="saveJoshi" />
                    <UButton :label="t.settings.editor.resetDefault" size="xs" color="neutral" variant="ghost" @click="resetJoshi" />
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection v-if="shown('sync')" id="sync" :title="t.settings.sections.sync">
            <SettingRow :label="t.settings.sync.onStart" :description="t.settings.sync.onStartDesc">
                <USwitch :model-value="app.prefs.syncOnStart" @update:model-value="(v: boolean) => setPref('syncOnStart', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.sync.pushOnSave" :description="t.settings.sync.pushOnSaveDesc">
                <USwitch :model-value="app.prefs.pushOnSave" @update:model-value="(v: boolean) => setPref('pushOnSave', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection v-if="shown('due')" id="due" :title="t.settings.sections.due">
            <SettingRow :label="t.settings.due.notify" :description="t.settings.due.notifyDesc">
                <USwitch :model-value="app.prefs.notifyDue" @update:model-value="(v: boolean) => setPref('notifyDue', v)" />
            </SettingRow>
            <SettingRow :label="t.settings.due.kinds" :description="t.settings.due.kindsDesc">
                <UButton
                    :label="t.settings.due.kindsButton"
                    icon="i-lucide-calendar-cog"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :disabled="!app.repoDir"
                    @click="app.openSettings('repo', 'kinds')"
                />
            </SettingRow>
        </SettingsSection>

        <SettingsSection v-if="shown('export')" id="export" :title="t.settings.sections.export">
            <SettingRow :label="t.settings.export.dir" :description="t.settings.export.dirDesc">
                <span class="path">{{ app.prefs.exportDir || t.settings.export.askEachTime }}</span>
                <UButton :label="t.settings.choose" size="sm" color="neutral" variant="outline" @click="pickExportDir" />
                <UButton
                    v-if="app.prefs.exportDir"
                    :label="t.settings.export.clear"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    @click="setPref('exportDir', '')"
                />
            </SettingRow>
            <SettingRow :label="t.settings.export.dateSuffix" :description="t.settings.export.dateSuffixDesc">
                <USwitch :model-value="app.prefs.exportDateSuffix" @update:model-value="(v: boolean) => setPref('exportDateSuffix', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection v-if="shown('signature')" id="signature" :title="t.settings.sections.signature">
            <SigningSettings />
        </SettingsSection>

        <SettingsSection id="print" :title="t.settings.sections.print">
            <p class="cd-muted note">{{ t.settings.print.note }}</p>
            <StyleEditor
                :model-value="app.prefs.docStyle"
                :inherited="app.prefs.docStyle"
                full
                @update:model-value="(v) => setPref('docStyle', { ...app.prefs.docStyle, ...v })"
            />
        </SettingsSection>

        <SettingsSection v-if="shown('remote')" id="remote" :title="t.settings.sections.remote">
            <ForgeAccountRow v-for="acc in app.accounts" :key="acc.base" :account="acc" />
            <GitLabHostAdd />
        </SettingsSection>

        <SettingsSection v-if="shown('ai')" id="ai" :title="t.settings.sections.ai">
            <AiProviderSettings @status="(s) => (ai = s)" />
            <SettingRow :label="t.settings.mcp.enable" :description="t.settings.mcp.enableDesc">
                <USwitch v-model="mcpEnabled" @update:model-value="applyMcp" />
            </SettingRow>
            <template v-if="mcpEnabled">
                <SettingRow :label="t.settings.mcp.port" :description="t.settings.mcp.portDesc">
                    <UInput v-model.number="mcpPort" type="number" class="cd-w-small" @change="applyMcp" />
                    <UBadge v-if="ai?.mcp.running" :label="t.settings.mcp.listening" color="success" variant="subtle" icon="i-lucide-radio" />
                    <UBadge v-else-if="ai?.mcp.error" :label="t.settings.mcp.cannotStart" color="error" variant="subtle" icon="i-lucide-circle-alert" />
                </SettingRow>
                <SettingRow :label="t.settings.mcp.token" :description="t.settings.mcp.tokenDesc">
                    <UInput :model-value="mcpToken" :type="showMcpToken ? 'text' : 'password'" class="cd-w-input" readonly>
                        <template #trailing>
                            <UButton
                                :icon="showMcpToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                                size="xs"
                                color="neutral"
                                variant="link"
                                @click="showMcpToken = !showMcpToken"
                            />
                        </template>
                    </UInput>
                    <UButton
                        :label="t.settings.copy"
                        icon="i-lucide-copy"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="copy(mcpToken, t.settings.mcp.token)"
                    />
                    <UButton :label="t.settings.mcp.regenerate" size="sm" color="neutral" variant="ghost" @click="regenerateToken" />
                </SettingRow>
                <SettingRow :label="t.settings.mcp.desktop" :description="desktopText">
                    <UBadge v-if="desktop?.state === 'registered'" :label="t.settings.mcp.registered" color="success" variant="subtle" icon="i-lucide-check" />
                    <UButton
                        v-if="desktop?.state === 'unregistered'"
                        :label="t.settings.mcp.register"
                        icon="i-lucide-plug"
                        size="sm"
                        @click="registerDesktop"
                    />
                    <UButton
                        v-if="desktop?.state === 'outdated'"
                        :label="t.settings.mcp.reregister"
                        icon="i-lucide-refresh-cw"
                        size="sm"
                        @click="registerDesktop"
                    />
                    <UButton
                        v-if="desktop?.state === 'registered' || desktop?.state === 'outdated'"
                        :label="t.settings.mcp.unregister"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        @click="unregisterDesktop"
                    />
                </SettingRow>
                <SettingRow :label="t.settings.mcp.code" stacked :description="t.settings.mcp.codeDesc">
                    <div class="cmd">
                        <code>{{ claudeCommand.replace(mcpToken, showMcpToken ? mcpToken : '••••••') }}</code>
                        <UButton
                            icon="i-lucide-copy"
                            size="xs"
                            color="neutral"
                            variant="outline"
                            :label="t.settings.copy"
                            @click="copy(claudeCommand, t.settings.mcp.command)"
                        />
                    </div>
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection v-if="shown('repos')" id="repos" :title="t.settings.sections.repos">
            <template v-for="g in repoGroups" :key="g.section || '-'">
                <h3 v-if="g.section" class="repo-sec">{{ g.section }}</h3>
                <SettingRow
                    v-for="r in g.repos"
                    :key="r.dir"
                    :label="r.name + (r.dir === app.repoDir ? t.settings.repos.inUse : '')"
                    :description="
                        (app.repoStates[r.dir] ?? 'ok') !== 'ok'
                            ? t.settings.repos.notFoundAt(r.dir)
                            : r.url
                              ? `${r.dir}${t.settings.repos.noteSep}${r.url}`
                              : r.dir
                    "
                >
                    <USelectMenu
                        :model-value="cleanSection(r.section) ?? noSection"
                        :items="sectionChoices"
                        create-item
                        size="sm"
                        icon="i-lucide-folder"
                        class="sec-select"
                        :aria-label="t.settings.repos.section"
                        @update:model-value="(v: string) => setSection(r, v)"
                        @create="(v: string) => setSection(r, v)"
                    />
                    <template v-if="(app.repoStates[r.dir] ?? 'ok') !== 'ok'">
                        <UBadge :label="t.settings.repos.notFound" color="warning" variant="subtle" icon="i-lucide-folder-x" />
                        <UButton :label="t.settings.repos.relocate" size="sm" color="neutral" variant="outline" @click="app.relocateRepo(r.dir)" />
                    </template>
                    <UButton
                        v-else-if="r.dir !== app.repoDir"
                        :label="t.settings.repos.switchTo"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="app.switchRepo(r.dir)"
                    />
                    <template v-if="(app.repoStates[r.dir] ?? 'ok') === 'ok'">
                        <UButton
                            :label="t.settings.repos.duplicate"
                            icon="i-lucide-copy"
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            :title="t.settings.repos.duplicateTitle"
                            @click="startDuplicate(r)"
                        />
                        <UButton
                            v-if="forgeOf(r)"
                            :label="t.settings.repos.fork"
                            icon="i-lucide-git-fork"
                            size="sm"
                            color="neutral"
                            variant="ghost"
                            :title="t.settings.repos.forkTitle"
                            @click="forkOf = r"
                        />
                    </template>
                    <UButton
                        :label="t.settings.repos.remove"
                        size="sm"
                        color="error"
                        variant="ghost"
                        :title="t.settings.repos.removeTitle"
                        @click="removeRepo(r)"
                    />
                </SettingRow>
            </template>
            <p v-if="app.settings!.repos.length === 0" class="cd-muted">{{ t.settings.repos.empty }}</p>

            <h3>{{ t.settings.repos.addHeading }}</h3>
            <SettingRow :label="t.settings.repos.addMethod" stacked>
                <SegmentSwitch v-model="mode" :items="MODES" :aria-label="t.settings.repos.addMethod" />
            </SettingRow>
            <SettingRow v-if="mode === 'clone'" :label="t.settings.repos.url" :description="t.settings.repos.urlDesc">
                <UInput v-model="url" class="cd-w-wide" :placeholder="t.settings.repos.urlPlaceholder" />
            </SettingRow>
            <SettingRow v-if="mode === 'open'" :label="t.settings.repos.folder" :description="t.settings.repos.folderDesc(MOD_KEY)">
                <span class="path">{{ folderPaths.length ? t.settings.repos.selectedCount(folderPaths.length) : t.settings.unselected }}</span>
                <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
            </SettingRow>
            <ul v-if="mode === 'open' && folderPaths.length" class="picked">
                <li v-for="p in folderPaths" :key="p" :title="p">
                    <UIcon name="i-lucide-folder" />{{ baseName(p) }}
                    <span class="cd-muted">{{ p }}</span>
                </li>
            </ul>
            <template v-else-if="mode !== 'open'">
                <SettingRow :label="t.settings.repos.name" :description="nameError || t.settings.repos.nameDesc">
                    <UInput
                        v-model="newName"
                        class="cd-w-input"
                        :placeholder="t.settings.repos.namePlaceholder"
                        :color="nameError ? 'error' : undefined"
                        :highlight="!!nameError"
                    />
                </SettingRow>
                <SettingRow :label="t.settings.repos.location" :description="t.settings.repos.locationDesc">
                    <span class="path">{{ folderPath || t.settings.unselected }}</span>
                    <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
                </SettingRow>
            </template>
            <div class="actions">
                <span v-if="mode !== 'open' && targetPath" class="cd-muted target"> <UIcon name="i-lucide-folder-plus" />{{ targetPath }} </span>
                <UButton
                    :label="
                        mode === 'open'
                            ? folderPaths.length > 1
                                ? t.settings.repos.addN(folderPaths.length)
                                : t.settings.add
                            : mode === 'clone'
                              ? t.settings.repos.cloneAdd
                              : t.settings.repos.createAdd
                    "
                    :disabled="!canAdd"
                    :loading="adding"
                    @click="addRepo"
                />
            </div>
        </SettingsSection>

        <SettingsSection v-if="shown('developer')" id="developer" :title="t.settings.sections.developer">
            <SettingRow :label="t.settings.developer.samples" :description="t.settings.developer.samplesDesc">
                <UButton
                    :label="t.settings.add"
                    icon="i-lucide-folder-plus"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :loading="samplesBusy"
                    @click="addSamples"
                />
            </SettingRow>
            <SettingRow :label="t.settings.developer.css" :description="t.settings.developer.cssDesc" stacked>
                <div class="css-box">
                    <CssEditor v-model="typesetCss" />
                    <div class="css-actions">
                        <span v-if="!isDefaultCss" class="cd-muted">{{ t.settings.developer.cssModified }}</span>
                        <UButton
                            :label="t.settings.developer.cssReset"
                            icon="i-lucide-rotate-ccw"
                            size="xs"
                            color="neutral"
                            variant="outline"
                            :disabled="isDefaultCss"
                            @click="typesetCss = defaultCss"
                        />
                    </div>
                </div>
            </SettingRow>
            <SettingRow :label="t.settings.developer.resetPrefs" :description="t.settings.developer.resetPrefsDesc">
                <UButton
                    :label="t.settings.developer.resetPrefsButton"
                    icon="i-lucide-rotate-ccw"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    @click="resetting = 'prefs'"
                />
            </SettingRow>
            <SettingRow :label="t.settings.developer.resetAll" :description="t.settings.developer.resetAllDesc">
                <UButton
                    :label="t.settings.developer.resetAllButton"
                    icon="i-lucide-trash-2"
                    size="sm"
                    color="error"
                    variant="outline"
                    @click="resetting = 'all'"
                />
            </SettingRow>

            <h3>{{ t.settings.developer.experiments }}</h3>
            <template v-for="e in EXPERIMENTS" :key="e.id">
                <SettingRow :description="e.description">
                    <template #label>
                        <span class="exp-label"
                            >{{ e.label }}
                            <UBadge :label="t.settings.developer.experimental" size="sm" color="warning" variant="subtle" icon="i-lucide-flask-conical" />
                        </span>
                    </template>
                    <USwitch :model-value="experimentOn(e.id)" @update:model-value="(v: boolean) => setExperiment(e.id, v)" />
                </SettingRow>
                <SettingRow
                    v-if="e.id === 'clauseLibrary' && experimentOn('clauseLibrary')"
                    :label="t.settings.developer.library"
                    :description="t.settings.developer.libraryDesc"
                >
                    <USelect
                        :model-value="libraryDir"
                        :items="libraryItems"
                        :placeholder="t.settings.developer.choosePlaceholder"
                        class="cd-w-input"
                        @update:model-value="setLibrary"
                    />
                </SettingRow>
            </template>
        </SettingsSection>
    </SettingsLayout>

    <ConfirmModal
        :open="resetting === 'prefs'"
        :title="t.settings.developer.resetPrefsTitle"
        :description="t.settings.developer.resetPrefsConfirm"
        :confirm-label="t.settings.developer.resetPrefsButton"
        :loading="resetBusy"
        @update:open="(v) => !v && (resetting = null)"
        @confirm="resetPrefs"
    />
    <ConfirmModal
        :open="resetting === 'all'"
        :title="t.settings.developer.resetAll"
        :description="t.settings.developer.resetAllConfirm"
        :confirm-label="t.settings.developer.resetAllButton"
        color="error"
        :loading="resetBusy"
        @update:open="(v) => !v && (resetting = null)"
        @confirm="resetAll"
    />

    <UModal
        :open="!!dupOf"
        :title="t.settings.repos.dupTitle"
        :description="t.settings.repos.dupDesc(dupOf?.name ?? '')"
        :dismissible="!dupBusy"
        @update:open="(v) => !v && (dupOf = null)"
    >
        <template #body>
            <div class="dup">
                <SettingRow :label="t.settings.repos.dupName" stacked>
                    <UInput v-model="dupName" class="cd-w-input" />
                </SettingRow>
                <SettingRow :label="t.settings.repos.location" stacked>
                    <span class="path">{{ dupParent || t.settings.unselected }}</span>
                    <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pickDupParent" />
                </SettingRow>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.settings.repos.cancel" color="neutral" variant="outline" :disabled="dupBusy" @click="dupOf = null" />
                <UButton :label="t.settings.repos.duplicate" :loading="dupBusy" :disabled="!dupName.trim() || !dupParent" @click="duplicate" />
            </div>
        </template>
    </UModal>

    <ConfirmModal
        :open="!!forkOf"
        :title="t.settings.repos.forkWith(forkWhere)"
        :confirm-label="t.settings.repos.fork"
        :loading="forkBusy"
        :description="t.settings.repos.forkDesc(forkWhere, forkOf?.name ?? '')"
        @update:open="(v) => !v && !forkBusy && (forkOf = null)"
        @confirm="fork"
    />
</template>

<style scoped>
.sub-row {
    padding-left: 20px;
}

.exp-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.accounts {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.accounts.empty {
    align-items: flex-start;
    font-size: 13px;
}

.account {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
}

.account .kind {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
}

.account .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    font-size: 13px;
}

.account .who .cd-muted {
    font-size: 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.adv-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 14px 0 4px;
    font-size: 12px;
    color: var(--ui-text-muted);
    cursor: pointer;
}

.adv-toggle:hover {
    color: var(--ui-text);
}

h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 24px 0 0;
}

h3.repo-sec {
    margin-top: 16px;
    color: var(--ui-text-muted);
}

.sec-select {
    width: 140px;
}

.css-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
}

.css-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    font-size: 12px;
}

.dup {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.path {
    font-size: 12px;
    color: var(--ui-text-muted);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sample {
    margin: 4px 0 8px;
    padding: 10px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--cd-ed-bg);
    color: var(--cd-ed-text);
    line-height: 1.8;
}

.picked {
    list-style: none;
    margin: 0 0 8px;
    padding: 8px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.picked li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
}

.picked .cd-muted {
    overflow: hidden;
    text-overflow: ellipsis;
}

.cmd {
    display: flex;
    gap: 8px;
    align-items: flex-start;
}

.cmd code {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--ui-bg-elevated);
    overflow-wrap: anywhere;
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

.actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 12px;
}

.target {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.note {
    margin: 8px 0 4px;
    line-height: 1.7;
}
</style>
