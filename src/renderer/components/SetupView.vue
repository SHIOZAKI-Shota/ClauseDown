<script setup lang="ts">
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import { DEFAULT_MCP_PORT, type AiStatus, type DesktopStatus, type RepoEntry } from '@shared/api'
import { EXPERIMENTS, isEnabled, type ExperimentId } from '@shared/experiments'
import { DEFAULT_JOSHI_ALLOW, PROOFREAD_RULES, ruleOn } from '@shared/proofread-rules'
import { EDITOR_FONTS, cssFont, type AppPrefs } from '@shared/prefs'
import { useApp } from '~/stores/app'
import { baseName } from '~/utils/folders'
import { useTheme, type ThemeMode } from '~/composables/useTheme'
import { useSavedFlash } from '~/composables/useSavedFlash'
import { useDebounced } from '~/composables/useDebounced'
import { FORGE_LABEL, knownBases, matchRemote } from '@shared/forge'
import { LEGAL_CSS } from '@shared/legal-css'
const app = useApp()
const { set: setTheme } = useTheme()

const SECTIONS = [
    { id: 'profile', label: 'あなたの情報', icon: 'i-lucide-user' },
    { id: 'display', label: '表示', icon: 'i-lucide-monitor' },
    { id: 'editor', label: 'エディタ', icon: 'i-lucide-square-pen' },
    { id: 'sync', label: '同期', icon: 'i-lucide-refresh-cw' },
    { id: 'due', label: '期日・有効期間', icon: 'i-lucide-calendar-clock' },
    { id: 'export', label: '書き出し', icon: 'i-lucide-download' },
    { id: 'print', label: '印刷・PDF・Word の書式', icon: 'i-lucide-type' },
    { id: 'remote', label: 'GitHub/GitLab', icon: 'i-lucide-cloud' },
    { id: 'ai', label: 'AI', icon: 'i-lucide-sparkles' },
    { id: 'repos', label: 'リポジトリの一覧', icon: 'i-lucide-archive' },
    { id: 'developer', label: 'Developer', icon: 'i-lucide-code-xml' },
]

const resetting = ref<'prefs' | 'all' | null>(null)
const resetBusy = ref(false)
async function resetPrefs() {
    resetBusy.value = true
    try {
        await app.resetPrefs()
        await setTheme('system')
        app.notify('表示・エディタなどの設定を初期値に戻しました')
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
    { label: '自動（ログイン中のアカウントのどれか）', value: 'auto' },
    ...signedIn.value.map((a) => ({ label: `${a.label}：${a.name}（@${a.login}）`, value: a.base })),
])
const nameSource = computed({
    get: () => (identityDefault.value === 'manual' ? 'manual' : 'login'),
    set: (v: 'login' | 'manual') => (identityDefault.value = v === 'manual' ? 'manual' : 'auto'),
})
const SOURCES: SegmentItem[] = [
    { value: 'login', label: 'GitHub・GitLab のアカウント', icon: 'i-lucide-log-in' },
    { value: 'manual', label: '自分で入力する', icon: 'i-lucide-pencil' },
]

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
    ai.value = await window.api.aiStatus()
    if (mcpEnabled.value) mcpToken.value = await window.api.getMcpToken()
    void refreshDesktop()
})
const DESKTOP_TEXT: Record<DesktopStatus['state'], string> = {
    registered: '登録済みです。Claude Desktop のチャットから ClauseDown の文書を扱えます。',
    unregistered: 'ボタンを押すと、Claude Desktop から ClauseDown の文書を扱えるようにします。',
    outdated: 'ClauseDown の場所が変わったため、登録し直す必要があります。',
    notInstalled: 'Claude Desktop が見つかりません。入れて一度起動してから、この画面を開き直してください。',
    broken: '',
}
const desktopText = computed(() => (desktop.value ? (desktop.value.error ?? DESKTOP_TEXT[desktop.value.state]) : ''))
async function registerDesktop() {
    const s = await app.run(() => window.api.registerDesktop(), 'Claude Desktop に登録しました。Claude Desktop を再起動すると使えます')
    if (s) desktop.value = s
}
async function unregisterDesktop() {
    const s = await app.run(() => window.api.unregisterDesktop(), 'Claude Desktop への登録を外しました。Claude Desktop を再起動すると反映されます')
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
    const t = await app.run(() => window.api.regenerateMcpToken(), '接続用トークンを作り直しました。つないでいる AI の設定も新しいトークンに変えてください')
    if (t) mcpToken.value = t
}
const mcpUrl = computed(() => ai.value?.mcp.url || `http://127.0.0.1:${mcpPort.value}/mcp`)
const claudeCommand = computed(() => `claude mcp add --transport http clausedown ${mcpUrl.value} --header "Authorization: Bearer ${mcpToken.value}"`)
async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text)
    app.notify(`${what}をコピーしました`)
}

const mode = ref<'new' | 'open' | 'clone'>('new')
const url = ref('')
const folderPath = ref('')
const folderPaths = ref<string[]>([])
const newName = ref('')
const adding = computed(() => app.busy)
const MODES: SegmentItem<'new' | 'open' | 'clone'>[] = [
    { value: 'new', label: '新しく作る（ローカル）', icon: 'i-lucide-folder-plus' },
    { value: 'open', label: 'ローカル にあるフォルダを開く', icon: 'i-lucide-folder-open' },
    { value: 'clone', label: 'GitHub・GitLab から取得', icon: 'i-lucide-cloud-download' },
]
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
    if (/[\\/:*?"<>|]/.test(n)) return '\\ / : * ? " < > | は名前に使えません'
    if (n.startsWith('.') || n.endsWith('.') || n.endsWith(' ')) return '点で始まる・点や空白で終わる名前は使えません'
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
    const notes = [
        notRepo.length ? `リポジトリではないため追加できませんでした：${notRepo.join('、')}（.git フォルダがある場所を選んでください）` : '',
        already.length ? `すでに一覧にあります：${already.join('、')}` : '',
    ].filter(Boolean)
    if (added.length) app.notify(`${added.length}件のリポジトリを追加しました`)
    if (notes.length) app.notify(notes.join(' ／ '), !added.length || notRepo.length > 0)
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
    app.notify(`リポジトリ「${entry.name}」を${mode.value === 'clone' ? '取得' : '作成'}しました`)
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
    dupName.value = `${r.name}_コピー`
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
    app.notify(`「${r.name}」を「${name}」として複製しました`)
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
    app.notify(`フォークしました。送信先を ${url.replace(/\.git$/, '')} に切り替えました`)
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
    app.notify(`サンプルリポジトリを ${made.length} 件追加しました`)
    const h = made.find((m) => m.name.startsWith('SAMPLE_houritsu'))
    if (h) await checkHouritsu(h.dir)
}
</script>

<template>
    <SettingsLayout
        :sections="SECTIONS"
        title="設定"
        scope="アプリ全体"
        note="リポジトリごとの設定がある項目は、そちらが優先されます。リポジトリごとの設定は、タイトルバーのリポジトリ名を押して「このリポジトリの設定」から開きます。"
        :saved="saved"
        id-prefix="s"
    >
        <SettingsSection id="profile" title="あなたの情報">
            <UAlert
                v-if="app.repoDir && app.identity"
                color="neutral"
                variant="subtle"
                icon="i-lucide-user-check"
                :title="`「${app.repo?.name}」では ${app.identity.name}${app.identity.email ? ` <${app.identity.email}>` : ''} として記録します`"
                :description="`${app.identity.label}の名前です`"
            />
            <UAlert
                v-else-if="!app.identity"
                color="warning"
                variant="subtle"
                icon="i-lucide-user-x"
                title="まだ名前が決まっていません"
                description="GitHub・GitLab にログインするか、下に名前を入れてください。決まるまで版を保存できません。"
            />

            <SettingRow label="名前の決め方" stacked>
                <SegmentSwitch v-model="nameSource" :items="SOURCES" aria-label="名前の決め方" />
            </SettingRow>

            <template v-if="nameSource === 'login'">
                <SettingRow label="ログイン中のアカウント" description="名前・メールを変えるときは、GitHub・GitLab のプロフィールで変えてください。" stacked>
                    <div v-if="signedIn.length" class="accounts">
                        <div v-for="a in signedIn" :key="a.base" class="account">
                            <UIcon :name="a.kind === 'github' ? 'i-lucide-github' : 'i-lucide-gitlab'" class="kind" />
                            <div class="who">
                                <strong>{{ a.name }}</strong>
                                <span class="cd-muted">@{{ a.login }}・{{ a.email || 'メールなし' }}・{{ a.label }}</span>
                            </div>
                            <UButton
                                label="プロフィールで変える"
                                icon="i-lucide-external-link"
                                size="xs"
                                color="neutral"
                                variant="ghost"
                                @click="openProfile(a.base, a.kind)"
                            />
                        </div>
                    </div>
                    <div v-else class="accounts empty">
                        <span class="cd-muted">ログインしていません。ログインすると、GitHub・GitLab の名前とメールで記録します。</span>
                        <UButton label="GitHub/GitLab でログイン" icon="i-lucide-log-in" size="sm" @click="goLogin" />
                    </div>
                </SettingRow>

                <SettingRow
                    v-if="signedIn.length > 1"
                    label="リモートの無いリポジトリで使うアカウント"
                    description="リモートが GitHub・GitLab のリポジトリでは、そのアカウントを使います。"
                >
                    <USelect v-model="identityDefault" :items="defaultItems" class="cd-w-input" />
                </SettingRow>
            </template>

            <template v-else>
                <SettingRow label="名前" description="すべてのリポジトリで、この名前を記録します。">
                    <UInput v-model="name" class="cd-w-input" placeholder="例：山田" />
                </SettingRow>
                <SettingRow label="メールアドレス" description="任意">
                    <UInput v-model="email" class="cd-w-input" placeholder="you@example.com" />
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection id="display" title="表示">
            <SettingRow label="配色">
                <SegmentSwitch
                    v-model="theme"
                    aria-label="配色"
                    :items="[
                        { value: 'light', label: 'ライト', icon: 'i-lucide-sun' },
                        { value: 'dark', label: 'ダーク', icon: 'i-lucide-moon' },
                        { value: 'system', label: 'システムに合わせる', icon: 'i-lucide-monitor' },
                    ]"
                />
            </SettingRow>
            <SettingRow label="画面の拡大率">
                <USelect :model-value="app.prefs.uiScale" :items="SCALES" class="cd-w-small" @update:model-value="(v: number) => setPref('uiScale', v)" />
            </SettingRow>
            <SettingRow label="起動時に前回の文書を開く">
                <USwitch :model-value="app.prefs.reopenLastDoc" @update:model-value="(v: boolean) => setPref('reopenLastDoc', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="editor" title="エディタ">
            <SettingRow label="フォント">
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
            <SettingRow label="行番号を表示する">
                <USwitch :model-value="app.prefs.lineNumbers" @update:model-value="(v: boolean) => setPref('lineNumbers', v)" />
            </SettingRow>
            <SettingRow label="長い行を折り返す">
                <USwitch :model-value="app.prefs.lineWrap" @update:model-value="(v: boolean) => setPref('lineWrap', v)" />
            </SettingRow>
            <SettingRow label="条・項の番号を行頭に表示する">
                <template #description>
                    <span class="cd-hint cd-hint-article">第3条</span> <span class="cd-hint">２</span>
                    <span class="cd-hint">一</span> などの番号を、エディタの行頭にだけ表示します
                </template>
                <USwitch :model-value="app.prefs.numberHints" @update:model-value="(v: boolean) => setPref('numberHints', v)" />
            </SettingRow>
            <SettingRow
                label="校閲（黄色の波線）を表示する"
                description="下の規則に当てはまる書き方に、黄色の波線を引きます。規則ごとに切り替えられます。定義語の誤り（赤い波線）は、この設定に関係なく表示します。"
            >
                <USwitch :model-value="app.prefs.proofread" @update:model-value="(v: boolean) => setPref('proofread', v)" />
            </SettingRow>
            <template v-if="app.prefs.proofread">
                <SettingRow v-for="r in PROOFREAD_RULES" :key="r.id" :description="r.description" class="sub-row">
                    <template #label>{{ r.label }}</template>
                    <USwitch :model-value="proofreadRuleOn(r.id)" @update:model-value="(v: boolean) => setProofreadRule(r.id, v)" />
                </SettingRow>
                <SettingRow
                    v-if="proofreadRuleOn('no-doubled-joshi')"
                    label="「同じ助詞の連続」で許す助詞"
                    class="sub-row"
                    description="ここに書いた助詞は、一文に重なっても指摘しません。条文は一文が長いので、「に」「が」などは初めから許しています。読点（、）で区切って書きます。"
                >
                    <UInput v-model="joshiText" class="cd-w-input" @change="saveJoshi" />
                    <UButton label="初期値に戻す" size="xs" color="neutral" variant="ghost" @click="resetJoshi" />
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection id="sync" title="同期">
            <SettingRow label="起動したら同期する" description="アプリを起動したときに、リモートの最新の状態を取得します">
                <USwitch :model-value="app.prefs.syncOnStart" @update:model-value="(v: boolean) => setPref('syncOnStart', v)" />
            </SettingRow>
            <SettingRow label="版を保存したら送信する" description="オフにすると、「同期」を押すまでリモートに版を送信しません">
                <USwitch :model-value="app.prefs.pushOnSave" @update:model-value="(v: boolean) => setPref('pushOnSave', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="due" title="期日・有効期間">
            <SettingRow label="期日をデスクトップに通知する" description="登録しているすべてのリポジトリの期日を一度だけ通知します">
                <USwitch :model-value="app.prefs.notifyDue" @update:model-value="(v: boolean) => setPref('notifyDue', v)" />
            </SettingRow>
            <SettingRow label="期日の種類" description="リポジトリごとに決定">
                <UButton
                    label="このリポジトリの期日の種類"
                    icon="i-lucide-calendar-cog"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    :disabled="!app.repoDir"
                    @click="app.openSettings('repo', 'kinds')"
                />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="export" title="書き出し">
            <SettingRow label="既定の保存先" description="PDF・Word の書き出しと、納品一式の保存に使うフォルダです">
                <span class="path">{{ app.prefs.exportDir || '（毎回選ぶ）' }}</span>
                <UButton label="選ぶ" size="sm" color="neutral" variant="outline" @click="pickExportDir" />
                <UButton v-if="app.prefs.exportDir" label="解除" size="sm" color="neutral" variant="ghost" @click="setPref('exportDir', '')" />
            </SettingRow>
            <SettingRow label="ファイル名に日付を付ける" description="例：業務委託契約書_20261103.pdf">
                <USwitch :model-value="app.prefs.exportDateSuffix" @update:model-value="(v: boolean) => setPref('exportDateSuffix', v)" />
            </SettingRow>
        </SettingsSection>

        <SettingsSection id="print" title="印刷・PDF・Word の書式">
            <p class="cd-muted note">各リポジトリの設定が優先されます。</p>
            <StyleEditor
                :model-value="app.prefs.docStyle"
                :inherited="app.prefs.docStyle"
                full
                @update:model-value="(v) => setPref('docStyle', { ...app.prefs.docStyle, ...v })"
            />
        </SettingsSection>

        <SettingsSection id="remote" title="GitHub/GitLab">
            <ForgeAccountRow v-for="acc in app.accounts" :key="acc.base" :account="acc" />
            <GitLabHostAdd />
        </SettingsSection>

        <SettingsSection id="ai" title="AI">
            <AiProviderSettings @status="(st) => (ai = st)" />
            <SettingRow
                label="外部の AI からつなぐ（MCP）"
                description="Claude Code などの AI から、ローカル の ClauseDown の文書を読む・チェックする・書き換えることができるようにします。アプリの起動中に、ローカル の中からだけ接続できます。版の保存・現行版への反映・納品はできません。"
            >
                <USwitch v-model="mcpEnabled" @update:model-value="applyMcp" />
            </SettingRow>
            <template v-if="mcpEnabled">
                <SettingRow label="ポート番号" description="ほかのアプリと重なったときだけ変えてください。">
                    <UInput v-model.number="mcpPort" type="number" class="cd-w-small" @change="applyMcp" />
                    <UBadge v-if="ai?.mcp.running" label="待ち受け中" color="success" variant="subtle" icon="i-lucide-radio" />
                    <UBadge v-else-if="ai?.mcp.error" label="開始できません" color="error" variant="subtle" icon="i-lucide-circle-alert" />
                </SettingRow>
                <SettingRow label="接続用トークン" description="AI 側の設定に入力します。ほかの人に知られたら作り直してください。">
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
                    <UButton label="コピー" icon="i-lucide-copy" size="sm" color="neutral" variant="outline" @click="copy(mcpToken, '接続用トークン')" />
                    <UButton label="作り直す" size="sm" color="neutral" variant="ghost" @click="regenerateToken" />
                </SettingRow>
                <SettingRow label="Claude Desktop への登録" :description="desktopText">
                    <UBadge v-if="desktop?.state === 'registered'" label="登録済み" color="success" variant="subtle" icon="i-lucide-check" />
                    <UButton v-if="desktop?.state === 'unregistered'" label="登録する" icon="i-lucide-plug" size="sm" @click="registerDesktop" />
                    <UButton v-if="desktop?.state === 'outdated'" label="登録し直す" icon="i-lucide-refresh-cw" size="sm" @click="registerDesktop" />
                    <UButton
                        v-if="desktop?.state === 'registered' || desktop?.state === 'outdated'"
                        label="登録を外す"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        @click="unregisterDesktop"
                    />
                </SettingRow>
                <SettingRow
                    label="Claude Code への登録"
                    stacked
                    description="ターミナルで次のコマンドを実行すると、Claude Code から ClauseDown の文書を扱えます。"
                >
                    <div class="cmd">
                        <code>{{ claudeCommand.replace(mcpToken, showMcpToken ? mcpToken : '••••••') }}</code>
                        <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="outline" label="コピー" @click="copy(claudeCommand, 'コマンド')" />
                    </div>
                </SettingRow>
            </template>
        </SettingsSection>

        <SettingsSection id="repos" title="リポジトリの一覧">
            <SettingRow
                v-for="r in app.settings!.repos"
                :key="r.dir"
                :label="r.name + (r.dir === app.repoDir ? '（使用中）' : '')"
                :description="(app.repoStates[r.dir] ?? 'ok') !== 'ok' ? `見つかりません：${r.dir}` : r.url ? `${r.dir} ／ ${r.url}` : r.dir"
            >
                <template v-if="(app.repoStates[r.dir] ?? 'ok') !== 'ok'">
                    <UBadge label="見つかりません" color="warning" variant="subtle" icon="i-lucide-folder-x" />
                    <UButton label="新しい場所を選ぶ" size="sm" color="neutral" variant="outline" @click="app.relocateRepo(r.dir)" />
                </template>
                <UButton v-else-if="r.dir !== app.repoDir" label="切り替える" size="sm" color="neutral" variant="outline" @click="app.switchRepo(r.dir)" />
                <template v-if="(app.repoStates[r.dir] ?? 'ok') === 'ok'">
                    <UButton
                        label="複製"
                        icon="i-lucide-copy"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        title="履歴ごと別のフォルダにコピーします。リモートは外れます"
                        @click="startDuplicate(r)"
                    />
                    <UButton
                        v-if="forgeOf(r)"
                        label="フォーク"
                        icon="i-lucide-git-fork"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        title="GitHub・GitLab に自分のコピーを作り、送信先をそちらに切り替えます"
                        @click="forkOf = r"
                    />
                </template>
                <UButton label="一覧から外す" size="sm" color="error" variant="ghost" title="一覧から外すだけで、ファイルは消えません" @click="removeRepo(r)" />
            </SettingRow>
            <p v-if="app.settings!.repos.length === 0" class="cd-muted">リポジトリがありません。下の「リポジトリを追加する」から追加してください。</p>

            <h3>リポジトリを追加する</h3>
            <SettingRow label="追加方法" stacked>
                <SegmentSwitch v-model="mode" :items="MODES" aria-label="追加方法" />
            </SettingRow>
            <SettingRow
                v-if="mode === 'clone'"
                label="リポジトリの URL"
                description="例：https://github.com/組織名/リポジトリ名、https://gitlab.com/組織名/リポジトリ名"
            >
                <UInput v-model="url" class="cd-w-wide" placeholder="https://github.com/組織名/リポジトリ名" />
            </SettingRow>
            <SettingRow
                v-if="mode === 'open'"
                label="フォルダ"
                :description="`${MOD_KEY} や Shift を押しながら選ぶと、複数のリポジトリをまとめて追加できます。`"
            >
                <span class="path">{{ folderPaths.length ? `${folderPaths.length}件を選択` : '（未選択）' }}</span>
                <UButton label="選ぶ" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
            </SettingRow>
            <ul v-if="mode === 'open' && folderPaths.length" class="picked">
                <li v-for="p in folderPaths" :key="p" :title="p">
                    <UIcon name="i-lucide-folder" />{{ baseName(p) }}
                    <span class="cd-muted">{{ p }}</span>
                </li>
            </ul>
            <template v-else-if="mode !== 'open'">
                <SettingRow label="リポジトリの名前" :description="nameError || 'この名前のフォルダを作ります。例：〇〇法案、A社_契約書、B社_規程'">
                    <UInput
                        v-model="newName"
                        class="cd-w-input"
                        placeholder="例：A社_契約書"
                        :color="nameError ? 'error' : undefined"
                        :highlight="!!nameError"
                    />
                </SettingRow>
                <SettingRow label="作る場所" description="選んだフォルダの中に、上の名前のフォルダを作ります。">
                    <span class="path">{{ folderPath || '（未選択）' }}</span>
                    <UButton label="選ぶ" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
                </SettingRow>
            </template>
            <div class="actions">
                <span v-if="mode !== 'open' && targetPath" class="cd-muted target"> <UIcon name="i-lucide-folder-plus" />{{ targetPath }} </span>
                <UButton
                    :label="
                        mode === 'open'
                            ? folderPaths.length > 1
                                ? `${folderPaths.length}件を追加`
                                : '追加'
                            : mode === 'clone'
                              ? '取得して追加'
                              : '作成して追加'
                    "
                    :disabled="!canAdd"
                    :loading="adding"
                    @click="addRepo"
                />
            </div>
        </SettingsSection>

        <SettingsSection id="developer" title="Developer">
            <SettingRow
                label="サンプルリポジトリを追加"
                description="社内規程・契約書・条例と要綱・houritsu 形式の法令の 4 つを、選んだフォルダに作って一覧に加えます。版の履歴・改定案・施行日・期日が付いています。"
            >
                <UButton label="追加" icon="i-lucide-folder-plus" size="sm" color="neutral" variant="outline" :loading="samplesBusy" @click="addSamples" />
            </SettingRow>
            <SettingRow
                label="版組 CSS"
                description="条文のプレビューと、PDF・新旧対照表の PDF の見た目を決める CSS です。書き換えると、すぐプレビューに反映します。すべて消すと既定の CSS を使います。Word の書き出しには使いません。"
                stacked
            >
                <div class="css-box">
                    <CssEditor v-model="typesetCss" />
                    <div class="css-actions">
                        <span v-if="!isDefaultCss" class="cd-muted">既定から書き換えています</span>
                        <UButton
                            label="既定に戻す"
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
            <SettingRow
                label="表示・エディタなどの設定を初期値に戻す"
                description="配色・拡大率・エディタ・同期・期日の通知・書き出し・印刷の書式・版組 CSS を、最初の状態に戻します。あなたの情報・ログイン・AI・リポジトリの一覧は変わりません。"
            >
                <UButton label="初期値に戻す" icon="i-lucide-rotate-ccw" size="sm" color="neutral" variant="outline" @click="resetting = 'prefs'" />
            </SettingRow>
            <SettingRow
                label="すべてを初期状態に戻す"
                description="ローカル に保存した設定・ログイン・AI の API キー・リポジトリの一覧をすべて消して、アプリを起動し直します。リポジトリのフォルダと文書は消えません。"
            >
                <UButton label="すべて初期化" icon="i-lucide-trash-2" size="sm" color="error" variant="outline" @click="resetting = 'all'" />
            </SettingRow>

            <h3>試験中の機能</h3>
            <template v-for="e in EXPERIMENTS" :key="e.id">
                <SettingRow :description="e.description">
                    <template #label>
                        <span class="exp-label"
                            >{{ e.label }}
                            <UBadge label="試験中" size="sm" color="warning" variant="subtle" icon="i-lucide-flask-conical" />
                        </span>
                    </template>
                    <USwitch :model-value="experimentOn(e.id)" @update:model-value="(v: boolean) => setExperiment(e.id, v)" />
                </SettingRow>
                <SettingRow
                    v-if="e.id === 'clauseLibrary' && experimentOn('clauseLibrary')"
                    label="ライブラリに使うリポジトリ"
                    description="このリポジトリの文書に書いた条が、条項ライブラリに並びます。版の保存や同期は、通常のリポジトリと同様です"
                >
                    <USelect :model-value="libraryDir" :items="libraryItems" placeholder="選んでください" class="cd-w-input" @update:model-value="setLibrary" />
                </SettingRow>
            </template>
        </SettingsSection>
    </SettingsLayout>

    <ConfirmModal
        :open="resetting === 'prefs'"
        title="設定を初期値に戻す"
        description="表示・エディタ・同期・期日の通知・書き出し・印刷の書式・版組 CSS が、最初の状態に戻ります。"
        confirm-label="初期値に戻す"
        :loading="resetBusy"
        @update:open="(v) => !v && (resetting = null)"
        @confirm="resetPrefs"
    />
    <ConfirmModal
        :open="resetting === 'all'"
        title="すべてを初期状態に戻す"
        description="設定・ログイン・AI の API キー・リポジトリの一覧を消して、アプリを起動し直します。リポジトリのフォルダと文書は消えません。元には戻せません。"
        confirm-label="すべて初期化"
        color="error"
        :loading="resetBusy"
        @update:open="(v) => !v && (resetting = null)"
        @confirm="resetAll"
    />

    <UModal
        :open="!!dupOf"
        title="リポジトリを複製"
        :description="`「${dupOf?.name}」を、版の履歴ごと別のフォルダにコピーします。コピーにはリモートを付けません。`"
        :dismissible="!dupBusy"
        @update:open="(v) => !v && (dupOf = null)"
    >
        <template #body>
            <div class="dup">
                <SettingRow label="新しいリポジトリの名前" stacked>
                    <UInput v-model="dupName" class="cd-w-input" />
                </SettingRow>
                <SettingRow label="作る場所" stacked>
                    <span class="path">{{ dupParent || '（未選択）' }}</span>
                    <UButton label="選ぶ" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pickDupParent" />
                </SettingRow>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" :disabled="dupBusy" @click="dupOf = null" />
                <UButton label="複製" :loading="dupBusy" :disabled="!dupName.trim() || !dupParent" @click="duplicate" />
            </div>
        </template>
    </UModal>

    <ConfirmModal
        :open="!!forkOf"
        :title="`${forkWhere} でフォーク`"
        confirm-label="フォーク"
        :loading="forkBusy"
        :description="`${forkWhere} のあなたのアカウントに「${forkOf?.name}」のフォークを作ります。ローカル のリポジトリの送信先をフォークに切り替え、元のリポジトリは upstream として残します。`"
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
