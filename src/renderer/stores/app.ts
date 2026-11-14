import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type {
    AppSettings,
    Identity,
    BranchInfo,
    DocChangedEvent,
    RepoEntry,
    RepoState,
    DocFile,
    ForgeAccount,
    RepoRules,
    ReviewEvent,
    SyncState,
} from '@shared/api'
import { canApprove, DEFAULT_RULES, reviewStatus, type Reviewer, type ReviewStatus } from '@shared/review'
import { FORGE_LABEL, type ForgeKind } from '@shared/forge'
import { DEFAULT_PREFS, type AppPrefs, type DocStyle, type RecentDoc } from '@shared/prefs'
import { resolveStyle, type StyleLayers } from '@shared/folder-style'
import { toPlain } from '~/utils/ipc'
import { todayISO } from '~/utils/format'
import { IS_MAC } from '~/utils/platform'
import { dissolveSection, placeRepo, renameSection } from '@shared/repo-sections'
import { addDays } from '@shared/schedule'
import { useStoredRef } from '~/composables/useStoredRef'

export type View = 'home' | 'setup' | 'about' | 'repo' | 'docs' | 'schedule' | 'issues' | 'editor' | 'history' | 'compare' | 'releases'

export const useApp = defineStore('app', () => {
    const toast = useToast()

    const settings = ref<AppSettings | null>(null)
    const view = ref<View>('home')
    const settingsTab = ref<Partial<Record<'setup' | 'repo', string>>>({})
    const paletteOpen = ref(false)
    function openSettings(where: 'setup' | 'repo', tab?: string) {
        if (tab) settingsTab.value[where] = tab
        view.value = where
    }
    const repoStates = ref<Record<string, RepoState>>({})
    const docs = shallowRef<DocFile[]>([])
    const currentPath = ref<string | null>(null)
    const syncState = ref<SyncState | null>(null)
    const busyCount = ref(0)
    const busy = computed(() => busyCount.value > 0)
    const compareTarget = ref<{ oldOid: string; newOid: string } | null>(null)
    const historySelect = ref<string | null>(null)
    const releasesSelect = ref<string | null>(null)
    const jumpTo = ref<{ path: string; line: number } | null>(null)
    const branches = shallowRef<BranchInfo[]>([])
    const reviews = shallowRef<ReviewEvent[]>([])
    const rules = ref<RepoRules>({ ...DEFAULT_RULES })
    const styleLayers = ref<StyleLayers>({})
    const forge = ref<ForgeKind | null>(null)
    const forgeLabel = computed(() => (forge.value ? FORGE_LABEL[forge.value] : ''))
    const accounts = ref<ForgeAccount[]>([])
    async function refreshAccounts() {
        accounts.value = await window.api.accounts()
    }
    const reloadKey = ref(0)
    const dialog = ref<
        | null
        | { kind: 'newBranch'; from?: string }
        | { kind: 'merge'; from: string; into: string }
        | { kind: 'review'; branch: string }
        | { kind: 'newDoc'; folder?: string }
        | { kind: 'newEvent'; docPath?: string; date?: string }
        | { kind: 'houritsu'; dir: string; paths: string[] }
        | { kind: 'sectionName'; dir?: string; from?: string }
    >(null)

    const repoDir = computed(() => settings.value?.current ?? null)
    const repo = computed(() => settings.value?.repos.find((r) => r.dir === repoDir.value) ?? null)
    const repoProblem = computed<RepoState | null>(() => {
        const st = repoDir.value ? repoStates.value[repoDir.value] : undefined
        return st && st !== 'ok' ? st : null
    })
    const currentDoc = computed(() => docs.value.find((d) => d.path === currentPath.value) ?? null)
    const currentBranch = computed(() => branches.value.find((b) => b.current) ?? null)
    const mainBranch = computed(() => branches.value.find((b) => b.isMain) ?? null)
    const onDraft = computed(() => !!currentBranch.value && !currentBranch.value.isMain)
    const hasUnsaved = computed(() => docs.value.some((d) => d.changed))
    const identity = ref<Identity | null>(null)
    async function refreshIdentity() {
        identity.value = await window.api.identity(repoDir.value).catch(() => null)
    }
    watch(
        () => [repoDir.value, repo.value?.url, settings.value?.author, settings.value?.identityDefault, accounts.value],
        () => void refreshIdentity(),
        { deep: true },
    )
    const me = computed(() => identity.value?.name ?? '')
    const reviewer = computed<Reviewer>(() => ({ name: me.value || undefined, login: identity.value?.login }))
    const prefs = computed<AppPrefs>(() => ({ ...DEFAULT_PREFS, ...settings.value?.prefs }))
    const styleFor = (path: string) => resolveStyle(prefs.value.docStyle, styleLayers.value, path).style
    const style = computed<DocStyle>(() => styleFor(currentPath.value ?? ''))

    async function setPrefs(patch: Partial<AppPrefs>) {
        if (!settings.value) return
        await saveSettings({ ...settings.value, prefs: { ...prefs.value, ...patch } })
        if (patch.uiScale !== undefined) await window.api.setZoom(patch.uiScale)
    }

    let liveSave: ReturnType<typeof setTimeout> | undefined
    function setPrefsLive(patch: Partial<AppPrefs>) {
        if (!settings.value) return
        settings.value = { ...settings.value, prefs: { ...prefs.value, ...patch } }
        clearTimeout(liveSave)
        liveSave = setTimeout(() => void saveSettings(settings.value!), 500)
    }

    async function resetPrefs() {
        if (!settings.value) return
        const { lastDoc, recentDocs } = prefs.value
        await saveSettings({ ...settings.value, prefs: { ...structuredClone(DEFAULT_PREFS), lastDoc, recentDocs } })
        await window.api.setZoom(DEFAULT_PREFS.uiScale)
    }

    const statusOf = (b: BranchInfo): ReviewStatus => reviewStatus(reviews.value, b.name, b.oid, rules.value)
    const currentStatus = computed(() => (currentBranch.value && onDraft.value ? statusOf(currentBranch.value) : null))
    const toReview = computed(() =>
        branches.value.filter((b) => {
            if (b.isMain) return false
            const s = statusOf(b)
            if (s.state !== 'requested' && s.state !== 'outdated') return false
            return canApprove(reviewer.value, s.request, rules.value)
        }),
    )

    function notify(text: string, error = false) {
        toast.add({
            title: text,
            color: error ? 'error' : 'success',
            icon: error ? 'i-lucide-circle-alert' : 'i-lucide-circle-check',
            duration: error ? 8000 : 3000,
        })
    }

    function notifyExported(text: string, path: string) {
        toast.add({
            title: text,
            description: path.split(/[\\/]/).pop(),
            color: 'success',
            icon: 'i-lucide-circle-check',
            duration: 8000,
            actions: [
                { label: '開く', icon: 'i-lucide-external-link', size: 'sm', onClick: () => void run(() => window.api.openExported(path)) },
                {
                    label: IS_MAC ? 'Finder で表示' : 'エクスプローラーで表示',
                    size: 'sm',
                    color: 'neutral',
                    variant: 'outline',
                    onClick: () => void run(() => window.api.showExported(path)),
                },
            ],
        })
    }

    async function run<T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> {
        busyCount.value++
        try {
            const r = await fn()
            if (done) notify(done)
            return r
        } catch (e) {
            notify(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
            return undefined
        } finally {
            busyCount.value--
        }
    }

    async function runOk(fn: () => Promise<unknown>, done?: string): Promise<boolean> {
        const ok = await run(async () => {
            await fn()
            return true
        }, done)
        return !!ok
    }

    const docListeners = new Set<(e: DocChangedEvent) => void>()
    function onDocChanged(cb: (e: DocChangedEvent) => void): () => void {
        docListeners.add(cb)
        return () => docListeners.delete(cb)
    }
    let docChangeTimer: ReturnType<typeof setTimeout> | undefined
    window.api.onDocChanged((e) => {
        for (const cb of docListeners) cb(e)
        if (e.dir !== repoDir.value) return
        clearTimeout(docChangeTimer)
        docChangeTimer = setTimeout(() => void refreshDocList(), 300)
    })

    async function load() {
        settings.value = await window.api.getSettings()
        window.api.onOpenSchedule((e) => void (e.dir ? openSchedule(e.dir, e.docPath) : openScheduleAll()))
        await refreshAccounts()
        await window.api.setZoom(prefs.value.uiScale)
        await checkRepos()
        view.value = 'home'
        if (settings.value.repos.length) {
            await refreshDocs()
            const last = prefs.value.lastDoc
            if (prefs.value.reopenLastDoc && last?.dir === repoDir.value && docs.value.some((d) => d.path === last.path)) {
                currentPath.value = last.path
                view.value = 'editor'
            }
        }
    }

    async function checkRepos() {
        const dirs = settings.value?.repos.map((r) => r.dir) ?? []
        repoStates.value = dirs.length ? await window.api.repoStatus(dirs).catch(() => ({})) : {}
    }

    async function relocateRepo(oldDir: string) {
        if (!settings.value) return
        const dir = await window.api.pickFolder()
        if (!dir) return
        const r = await window.api.openRepo(dir)
        if (!r.ok) return notify(`選んだフォルダはリポジトリではありません（${r.message}）。移動先のリポジトリのフォルダを選んでください`, true)
        if (settings.value.repos.some((x) => x.dir === dir && x.dir !== oldDir)) return notify('そのフォルダはすでに一覧にあります', true)
        const repos = settings.value.repos.map((x) => (x.dir === oldDir ? { ...x, dir } : x))
        await saveSettings({ ...settings.value, repos, current: settings.value.current === oldDir ? dir : settings.value.current })
        await checkRepos()
        if (repoDir.value === dir) {
            await refreshDocs()
            view.value = 'docs'
        }
        notify('リポジトリの場所を更新しました')
    }

    async function forgetRepo(dir: string) {
        if (!settings.value) return
        const name = settings.value.repos.find((x) => x.dir === dir)?.name ?? dir
        const wasCurrent = settings.value.current === dir
        const repos = settings.value.repos.filter((x) => x.dir !== dir)
        const recentDocs = (prefs.value.recentDocs ?? []).filter((d) => d.dir !== dir)
        const current = wasCurrent ? repos[0]?.dir : settings.value.current
        if (wasCurrent) await flushEditor()
        await saveSettings({ ...settings.value, repos, current, prefs: { ...prefs.value, recentDocs } })
        await checkRepos()
        notify(`「${name}」を一覧から外しました（フォルダや版は残っています）`)
        if (!wasCurrent) return
        currentPath.value = null
        syncState.value = null
        docs.value = []
        branches.value = []
        reviews.value = []
        if (!repos.length) {
            if (!['home', 'setup', 'about'].includes(view.value)) view.value = 'home'
            return
        }
        await refreshDocs()
        if (!['home', 'setup', 'about'].includes(view.value)) view.value = 'home'
    }

    async function openRecent(r: RecentDoc) {
        if (repoStates.value[r.dir] && repoStates.value[r.dir] !== 'ok') return notify('この文書のリポジトリが見つかりません', true)
        if (r.dir !== repoDir.value) await switchRepo(r.dir)
        if (!docs.value.some((d) => d.path === r.path)) return notify(`「${r.title}」が見つかりません。名前の変更や削除がされた可能性があります`, true)
        openDoc(r.path)
    }

    async function saveSettings(next: AppSettings) {
        settings.value = next
        await window.api.saveSettings(toPlain(next))
    }

    async function setRepos(fn: (repos: RepoEntry[]) => RepoEntry[]) {
        if (!settings.value) return
        await run(() => saveSettings({ ...settings.value!, repos: fn(settings.value!.repos) }))
    }
    const moveRepo = (dir: string, to: { section?: string; before?: string }) => setRepos((r) => placeRepo(r, dir, to))
    const renameRepoSection = (from: string, to: string) => setRepos((r) => renameSection(r, from, to))
    const dissolveRepoSection = (name: string) => setRepos((r) => dissolveSection(r, name))

    let refreshing: Promise<void> | null = null
    let refreshAgain = false
    function refreshDocs(): Promise<void> {
        if (refreshing) {
            refreshAgain = true
            return refreshing
        }
        refreshing = (async () => {
            do {
                refreshAgain = false
                await loadRepoState()
            } while (refreshAgain)
        })().finally(() => (refreshing = null))
        return refreshing
    }

    async function refreshDocList() {
        const dir = repoDir.value
        if (!dir) return
        const d = await window.api.listDocs(dir).catch(() => null)
        if (d && dir === repoDir.value) docs.value = d
    }

    async function loadRepoState() {
        if (!repoDir.value) return
        const dir = repoDir.value
        const folderState = (await window.api.repoStatus([dir]).catch(() => ({}) as Record<string, RepoState>))[dir]
        if (folderState) repoStates.value = { ...repoStates.value, [dir]: folderState }
        if (folderState && folderState !== 'ok') {
            docs.value = []
            branches.value = []
            reviews.value = []
            return
        }
        const [d, b, r, rl, gh, st] = await Promise.all([
            window.api.listDocs(dir),
            window.api.listBranches(dir).catch(() => []),
            window.api.listReviews(dir).catch(() => []),
            window.api.getRules(dir).catch(() => ({ ...DEFAULT_RULES })),
            window.api.forgeKind(dir).catch(() => null),
            window.api.listFolderStyles(dir).catch(() => ({}) as StyleLayers),
        ])
        if (dir !== repoDir.value) return
        docs.value = d
        branches.value = b
        reviews.value = r
        rules.value = rl
        forge.value = gh
        styleLayers.value = st
    }

    let editorFlush: (() => Promise<void>) | null = null
    function setEditorFlush(fn: (() => Promise<void>) | null) {
        editorFlush = fn
    }
    function markChanged(path: string) {
        if (docs.value.some((d) => d.path === path && !d.changed)) docs.value = docs.value.map((d) => (d.path === path ? { ...d, changed: true } : d))
    }
    async function flushEditor() {
        if (editorFlush) await editorFlush()
    }

    async function afterBranchChange() {
        await refreshDocs()
        reloadKey.value++
        if (currentPath.value && !docs.value.some((d) => d.path === currentPath.value)) {
            notify('この改定案にはこの文書がありません。リポジトリホームに戻ります')
            currentPath.value = null
            view.value = 'docs'
        }
    }

    async function switchRepo(dir: string) {
        if (!settings.value || dir === repoDir.value) return
        await flushEditor()
        await saveSettings({ ...settings.value, current: dir })
        currentPath.value = null
        syncState.value = null
        docs.value = []
        branches.value = []
        reviews.value = []
        await refreshDocs()
        view.value = 'docs'
        if (!repoProblem.value) await sync()
    }

    async function switchBranch(name: string) {
        await flushEditor()
        if (!(await runOk(() => window.api.switchBranch(repoDir.value!, name)))) return false
        await afterBranchChange()
        notify(`「${branches.value.find((b) => b.name === name)?.label ?? name}」に切り替えました`)
        return true
    }

    function openDoc(path: string, to: View = 'editor') {
        currentPath.value = path
        compareTarget.value = null
        view.value = to
        if (repoDir.value) {
            const dir = repoDir.value
            const title = docs.value.find((d) => d.path === path)?.title ?? path
            const recentDocs = [
                { dir, path, title, at: Date.now() },
                ...(prefs.value.recentDocs ?? []).filter((d) => !(d.dir === dir && d.path === path)),
            ].slice(0, 12)
            void setPrefs({ lastDoc: { dir, path }, recentDocs })
        }
    }

    const scheduleDoc = ref<string | null>(null)
    const homeTab = useStoredRef<'recent' | 'schedule'>('clausedown.homeTab', 'recent')
    const scheduleKey = ref(0)
    const scheduleDir = ref<string | null>(null)
    function touchSchedule(dir?: string) {
        scheduleDir.value = dir ?? null
        scheduleKey.value++
    }
    async function openSchedule(dir?: string, docPath?: string) {
        if (dir && dir !== repoDir.value) {
            if (!settings.value?.repos.some((r) => r.dir === dir)) return
            await switchRepo(dir)
        }
        scheduleDoc.value = docPath || null
        view.value = 'schedule'
    }
    const issueTarget = ref<{ n?: number; draft?: { title: string; body: string } } | null>(null)
    function openIssues(target: { n?: number; draft?: { title: string; body: string } } | null = null) {
        if (!repoDir.value) return
        issueTarget.value = target
        view.value = 'issues'
    }
    function openScheduleAll() {
        homeTab.value = 'schedule'
        view.value = 'home'
    }

    function openCompare(oldOid: string, newOid: string) {
        compareTarget.value = { oldOid, newOid }
        if (view.value === 'compare') reloadKey.value++
        view.value = 'compare'
    }

    async function publishRepo(url: string): Promise<boolean> {
        const dir = repoDir.value
        if (!dir || !settings.value) return false
        await flushEditor()
        const saved = await run(() => window.api.publishRepo(dir, url))
        if (!saved) return false
        await saveSettings({ ...settings.value, repos: settings.value.repos.map((r) => (r.dir === dir ? { ...r, url: saved } : r)) })
        await refreshDocs()
        syncState.value = await window.api.sync(dir)
        notify('共有を始めました。これからは「リモート」を押すと同期します')
        return true
    }

    async function setRepoUrl(dir: string, url: string | undefined) {
        if (!settings.value) return
        await saveSettings({ ...settings.value, repos: settings.value.repos.map((r) => (r.dir === dir ? { ...r, url } : r)) })
    }

    async function changeRemote(url: string): Promise<boolean> {
        const dir = repoDir.value
        if (!dir) return false
        await flushEditor()
        const saved = await run(() => window.api.changeRemote(dir, url))
        if (!saved) return false
        await setRepoUrl(dir, saved)
        await refreshDocs()
        syncState.value = await window.api.sync(dir)
        notify('リモートを変更しました')
        return true
    }

    async function disconnectRemote(): Promise<boolean> {
        const dir = repoDir.value
        if (!dir) return false
        if (!(await runOk(() => window.api.disconnectRemote(dir)))) return false
        await setRepoUrl(dir, undefined)
        await refreshDocs()
        syncState.value = { state: 'local' }
        notify('リモートを外しました。ローカル だけで管理します')
        return true
    }

    let syncing: ReturnType<typeof runSync> | null = null
    function sync() {
        syncing ??= runSync().finally(() => (syncing = null))
        return syncing
    }
    async function runSync() {
        if (!repoDir.value || repoProblem.value) return
        await flushEditor()
        busyCount.value++
        try {
            let s = await window.api.sync(repoDir.value)
            if (s.state === 'ahead') s = await window.api.push(repoDir.value)
            syncState.value = s
            if (s.state === 'behind') {
                await afterBranchChange()
                syncState.value = { state: 'upToDate' }
                notify('最新の版を取得しました')
            } else {
                await refreshDocs()
            }
            if (s.state === 'error') notify(s.message, true)
            return s
        } finally {
            busyCount.value--
        }
    }

    const OVERLAY: View[] = ['setup', 'about', 'repo']
    const DOC_VIEWS: View[] = ['editor', 'history', 'compare', 'releases']
    type DocView = 'editor' | 'history' | 'compare' | 'releases'
    const returnView = ref<View | null>(null)
    const lastDocView = ref<DocView>('editor')
    type Page = 'issues' | 'schedule'
    const PAGES: View[] = ['issues', 'schedule']
    const pageFrom = ref<Record<Page, View | null>>({ issues: null, schedule: null })
    watch(view, (to, from) => {
        if (OVERLAY.includes(to) && !OVERLAY.includes(from)) returnView.value = from
        if (PAGES.includes(to) && from !== to && !OVERLAY.includes(from)) pageFrom.value[to as Page] = from
        if (to === 'docs') void Promise.all([refreshIssueCount(), refreshDueCount()])
        if (DOC_VIEWS.includes(to)) lastDocView.value = to as DocView
    })
    const backTarget = computed<View>(() => {
        const v = returnView.value
        if (!repoDir.value || !v) return 'home'
        if (DOC_VIEWS.includes(v) && !currentDoc.value) return 'docs'
        return v
    })
    const returnLabel = computed(() => labelForReturn(backTarget.value))
    function pageBack(page: Page): View {
        const v = pageFrom.value[page]
        if (!v || v === page || !repoDir.value) return repoDir.value ? 'docs' : 'home'
        if (DOC_VIEWS.includes(v) && !currentDoc.value) return 'docs'
        return v
    }
    const pageReturnLabel = (page: Page) => labelForReturn(pageBack(page))
    function leavePage(page: Page) {
        view.value = pageBack(page)
    }
    const dueCount = ref<{ due: number; overdue: number } | null>(null)
    let dueCountSeq = 0
    async function refreshDueCount() {
        const dir = repoDir.value
        const seq = ++dueCountSeq
        if (!dir) return (dueCount.value = null)
        const today = todayISO()
        const until = addDays(today, 30)
        const r = await window.api.occurrences(dir, addDays(today, -365 * 5), until, today).catch(() => null)
        if (seq !== dueCountSeq) return
        if (!r) return (dueCount.value = null)
        const due = r.items.filter((o) => o.source !== 'delivery' && (o.overdue || (!o.done && (o.end ?? o.date) >= today && o.date <= until)))
        dueCount.value = { due: due.length, overdue: due.filter((o) => o.overdue).length }
    }
    watch(scheduleKey, () => void refreshDueCount())
    const openIssueCount = ref<number | null>(null)
    let issueCountSeq = 0
    async function refreshIssueCount() {
        const dir = repoDir.value
        const seq = ++issueCountSeq
        if (!dir) return (openIssueCount.value = null)
        const list = await window.api.listIssues(dir).catch(() => null)
        if (seq === issueCountSeq) openIssueCount.value = list ? list.filter((i) => i.state === 'open').length : null
    }
    watch(
        repoDir,
        () => {
            openIssueCount.value = null
            dueCount.value = null
            void refreshIssueCount()
            void refreshDueCount()
        },
        { immediate: true },
    )
    function labelForReturn(v: View) {
        if (DOC_VIEWS.includes(v)) return `${currentDoc.value?.title ?? '文書'}に戻る`
        if (v === 'docs') return 'リポジトリホームに戻る'
        if (v === 'schedule') return '期日・有効期間の画面に戻る'
        if (v === 'issues') return '課題の画面に戻る'
        return 'トップページに戻る'
    }
    function goBack() {
        view.value = backTarget.value
    }
    function goRepoHome() {
        view.value = repoDir.value ? 'docs' : 'home'
    }

    return {
        settings,
        view,
        settingsTab,
        openSettings,
        paletteOpen,
        docs,
        currentPath,
        currentDoc,
        syncState,
        busy,
        compareTarget,
        historySelect,
        releasesSelect,
        dialog,
        branches,
        currentBranch,
        mainBranch,
        onDraft,
        hasUnsaved,
        reloadKey,
        reviews,
        rules,
        style,
        styleLayers,
        styleFor,
        forge,
        forgeLabel,
        accounts,
        refreshAccounts,
        me,
        identity,
        refreshIdentity,
        reviewer,
        prefs,
        setPrefs,
        setPrefsLive,
        resetPrefs,
        statusOf,
        currentStatus,
        toReview,
        repoDir,
        repo,
        repoStates,
        repoProblem,
        checkRepos,
        relocateRepo,
        forgetRepo,
        openRecent,
        load,
        saveSettings,
        moveRepo,
        renameRepoSection,
        dissolveRepoSection,
        refreshDocs,
        onDocChanged,
        publishRepo,
        changeRemote,
        disconnectRemote,
        setEditorFlush,
        flushEditor,
        markChanged,
        setRepoUrl,
        switchRepo,
        switchBranch,
        afterBranchChange,
        openDoc,
        openCompare,
        returnLabel,
        goBack,
        pageReturnLabel,
        leavePage,
        openIssueCount,
        refreshIssueCount,
        dueCount,
        refreshDueCount,
        goRepoHome,
        lastDocView,
        jumpTo,
        openSchedule,
        openScheduleAll,
        openIssues,
        issueTarget,
        homeTab,
        scheduleDoc,
        scheduleKey,
        scheduleDir,
        touchSchedule,
        run,
        runOk,
        notify,
        notifyExported,
        sync,
    }
})
