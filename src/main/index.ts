import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import type { AiStatus, AppSettings, DocChangedEvent, McpConfig } from '../shared/api'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import * as git from './git'
import * as docOps from './doc-ops'
import * as repoHome from './repo-home'
import { deliverWithDialog, exportFile, exportScheduleIcs, previewPdf } from './export'
import { checkUpdate, downloadUpdate, initUpdater, installUpdate, updateState } from './updater'
import * as wf from './workflow'
import * as schedule from './schedule'
import { startReminders } from './reminder'
import { convertHouritsu, detectHouritsu } from './houritsu'
import { withRepoLock } from './repo-lock'
import { duplicateRepo, forkRepo } from './repo-copy'
import { createSamples } from './samples'
import { suggestVersionMessage } from './ai-message'
import * as fstyle from './folder-style'
import * as accounts from './accounts'
import { identity } from './git-base'
import { forgetCachedSettings, loadSettings, resetAllData, saveSecret, updateSettings } from './settings'
import { listFonts } from './fonts'
import { saveImage } from './images'
import * as issues from './issues'
import { proofread, stopProofread } from './proofread'
import { imageExt } from '../shared/images'
import { setAppMenu } from './menu'
import { aiReset, aiRun, aiStop, testAi } from './ai-agent'
import { keyName, resolveAi } from './ai/provider'
import { listAiModels } from './ai/models'
import { loginOpenRouter } from './ai/openrouter-auth'
import { aiBaseOf, cleanAiConfig, type AiConfig, type AiProvider } from '../shared/ai-providers'
import { applyMcp, mcpState, mcpToken, regenerateMcpToken } from './mcp-server'
import { desktopStatus, registerDesktop, unregisterDesktop } from './claude-desktop'

try {
    setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')])
} catch (e) {
    console.error('[tls] OS の証明書を読み込めませんでした', e)
}

let win: BrowserWindow | null = null
const DEV_ICON = resolve(import.meta.dirname, '../../build/icon.png')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
].join('; ')

async function serveRepoImage(pathname: string): Promise<Response> {
    const [encDir, ...rest] = pathname.slice('/__repo/'.length).split('/')
    try {
        const dir = decodeURIComponent(encDir)
        const path = rest.map((s) => decodeURIComponent(s)).join('/')
        if (!imageExt(path)) return new Response('Forbidden', { status: 403 })
        await assertAllowedDir(dir)
        const full = git.safeJoin(dir, path)
        if (!statSync(full, { throwIfNoEntry: false })?.isFile()) return new Response('Not Found', { status: 404 })
        return await net.fetch(pathToFileURL(full).toString())
    } catch {
        return new Response('Forbidden', { status: 403 })
    }
}

function serveRenderer() {
    const root = resolve(import.meta.dirname, '../renderer')
    protocol.handle('app', async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname.startsWith('/__repo/')) return serveRepoImage(pathname)
        let file = resolve(root, '.' + decodeURIComponent(pathname))
        if (file !== root && !file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
        if (!existsSync(file) || statSync(file).isDirectory()) {
            file = existsSync(join(root, '200.html')) ? join(root, '200.html') : join(root, 'index.html')
        }
        const res = await net.fetch(pathToFileURL(file).toString())
        const headers = new Headers(res.headers)
        headers.set('Content-Security-Policy', CSP)
        return new Response(res.body, { status: res.status, headers })
    })
}

const TITLEBAR = {
    light: { color: '#eef0f4', symbolColor: '#3b3f4a', background: '#ffffff' },
    dark: { color: '#121318', symbolColor: '#c9ccd6', background: '#0e0f13' },
}
export const TITLEBAR_HEIGHT = 40

function isDark(theme: AppSettings['theme']) {
    return theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors)
}

async function applyTheme(theme: AppSettings['theme']) {
    nativeTheme.themeSource = theme ?? 'system'
    const t = isDark(theme) ? TITLEBAR.dark : TITLEBAR.light
    if (win && process.platform !== 'darwin') {
        win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: TITLEBAR_HEIGHT })
    }
    win?.setBackgroundColor(t.background)
}

async function createWindow() {
    const { theme } = await loadSettings()
    nativeTheme.themeSource = theme ?? 'system'
    const t = isDark(theme) ? TITLEBAR.dark : TITLEBAR.light
    win = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1024,
        minHeight: 600,
        title: 'ClauseDown',
        backgroundColor: t.background,
        titleBarStyle: 'hidden',
        titleBarOverlay: process.platform === 'darwin' ? true : { color: t.color, symbolColor: t.symbolColor, height: TITLEBAR_HEIGHT },
        trafficLightPosition: { x: 14, y: 13 },
        autoHideMenuBar: true,
        ...(existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
        webPreferences: {
            preload: join(import.meta.dirname, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void shell.openExternal(url)
        return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e, url) => {
        if (url !== win?.webContents.getURL()) e.preventDefault()
    })
    win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'))
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void win.loadURL('app://bundle/')
}

const pickedRoots = new Set<string>()
const norm = (p: string) => resolve(p).toLowerCase()
const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)

async function assertAllowedDir(dir: unknown): Promise<void> {
    if (typeof dir !== 'string' || !dir) throw new Error('リポジトリが指定されていません')
    const d = norm(dir)
    const { repos } = await loadSettings()
    if (repos.some((r) => norm(r.dir) === d)) return
    if ([...pickedRoots].some((root) => under(d, root))) return
    throw new Error('このフォルダはリポジトリとして登録されていません')
}

function assertPicked(dir: unknown) {
    if (typeof dir !== 'string' || ![...pickedRoots].some((root) => under(norm(dir), root)))
        throw new Error('作る場所は、フォルダを選び直してから指定してください')
}

const DIR_FIRST = new Set([
    'openRepo',
    'initRepo',
    'listDocs',
    'readDoc',
    'writeDoc',
    'createDoc',
    'moveDoc',
    'copyDoc',
    'copyDocToRepo',
    'deleteDoc',
    'showDocInFolder',
    'repoActivity',
    'readRepoNote',
    'saveRepoNote',
    'log',
    'lastChange',
    'readAt',
    'saveVersion',
    'discardChanges',
    'sync',
    'push',
    'publishRepo',
    'changeRemote',
    'disconnectRemote',
    'resolveConflicts',
    'listBranches',
    'createBranch',
    'switchBranch',
    'previewMerge',
    'mergeBranch',
    'deleteBranch',
    'listEffective',
    'addEffective',
    'removeEffective',
    'listFolderStyles',
    'saveFolderStyle',
    'getRules',
    'saveRules',
    'forgeKind',
    'listReviews',
    'addReview',
    'listDeliveries',
    'deliver',
    'aiRun',
    'occurrences',
    'listEvents',
    'saveEvent',
    'deleteEvent',
    'setEventDone',
    'getEventKinds',
    'saveEventKinds',
    'detectHouritsu',
    'convertHouritsu',
    'duplicateRepo',
    'forkRepo',
    'suggestVersionMessage',
    'saveImage',
    'listIssues',
    'issueDetail',
    'createIssue',
    'updateIssue',
    'linkIssue',
    'commentIssue',
    'closeIssue',
    'branchIssues',
    'setBranchIssues',
    'pendingLocalIssues',
    'moveIssuesToForge',
])

const LOCKED = new Set([
    'initRepo',
    'writeDoc',
    'createDoc',
    'moveDoc',
    'copyDoc',
    'deleteDoc',
    'saveRepoNote',
    'saveVersion',
    'discardChanges',
    'sync',
    'push',
    'publishRepo',
    'changeRemote',
    'disconnectRemote',
    'resolveConflicts',
    'createBranch',
    'switchBranch',
    'mergeBranch',
    'deleteBranch',
    'addEffective',
    'removeEffective',
    'saveFolderStyle',
    'saveRules',
    'addReview',
    'deliver',
    'saveEvent',
    'deleteEvent',
    'setEventDone',
    'saveEventKinds',
    'convertHouritsu',
    'duplicateRepo',
    'forkRepo',
])

const notifyChanged = (by: DocChangedEvent['by']) => (dir: string, path: string) =>
    win?.webContents.send('docChanged', { dir, path, by } satisfies DocChangedEvent)

async function aiStatus(): Promise<AiStatus> {
    const r = await resolveAi()
    return { config: r.config, label: r.label, ready: r.ready, reason: r.reason, hasKey: !!r.key, local: r.local, mcp: mcpState() }
}

async function setAiKey(provider: AiProvider, key: unknown, baseUrl?: string): Promise<AiStatus> {
    const config = cleanAiConfig({ provider, baseUrl })
    const name = keyName(config.provider, aiBaseOf(config))
    if (!name) throw new Error('この接続先には API キーを保存できません')
    await saveSecret(name, typeof key === 'string' ? key.trim() : '')
    return aiStatus()
}

async function setAiConfig(config: AiConfig): Promise<AiStatus> {
    await updateSettings((s) => ({ ...s, ai: cleanAiConfig(config) }))
    return aiStatus()
}

const exported = new Set<string>()
function keepExported<T extends string | null>(p: T): T {
    if (p) exported.add(resolve(p))
    return p
}
function exportedPath(p: unknown): string {
    const full = typeof p === 'string' ? resolve(p) : ''
    if (!exported.has(full) || !statSync(full, { throwIfNoEntry: false })?.isFile()) throw new Error('ファイルが見つかりません')
    return full
}

async function openFolder(p: unknown): Promise<void> {
    if (typeof p !== 'string' || !(process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : isAbsolute(p))) throw new Error('この場所は開けません')
    const full = resolve(p)
    if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new Error('フォルダが見つかりません')
    await shell.openPath(full)
}

const handlers: Record<string, (...args: any[]) => unknown> = {
    getSettings: loadSettings,
    setTheme: async (theme: AppSettings['theme']) => {
        await updateSettings((s) => ({ ...s, theme }))
        await applyTheme(theme)
    },
    platform: async () => process.platform,
    listFonts,
    saveSettings: async (next: AppSettings) => {
        for (const r of next.repos ?? []) await assertAllowedDir(r.dir)
        const kept = new Set((next.repos ?? []).map((r) => norm(r.dir)))
        await updateSettings((cur) => {
            for (const r of cur.repos ?? []) if (!kept.has(norm(r.dir))) git.forgetRepo(r.dir)
            return { ...next, mcp: cur.mcp, ai: cur.ai }
        })
    },
    resetAll: async () => {
        await resetAllData()
        forgetCachedSettings()
        await win?.webContents.session.clearStorageData({ storages: ['localstorage'] })
        app.relaunch()
        app.exit(0)
    },
    detectHouritsu,
    duplicateRepo: async (dir: string, parent: string, name: string) => {
        if (typeof parent !== 'string' || norm(parent) !== norm(dirname(dir))) assertPicked(parent)
        const dest = await duplicateRepo(dir, parent, name)
        pickedRoots.add(norm(dest))
        return dest
    },
    forkRepo,
    suggestVersionMessage,
    createSamples: async (parent: string) => {
        assertPicked(parent)
        const made = await createSamples(parent)
        for (const m of made) pickedRoots.add(norm(m.dir))
        return made
    },
    convertHouritsu,
    hasToken: accounts.hasToken,
    setToken: accounts.setToken,
    pickFolder: async () => {
        const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
        if (r.canceled) return null
        pickedRoots.add(norm(r.filePaths[0]))
        return r.filePaths[0]
    },
    pickFolders: async () => {
        const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'multiSelections'] })
        if (r.canceled) return []
        for (const p of r.filePaths) pickedRoots.add(norm(p))
        return r.filePaths
    },
    cloneRepo: async (url: string, dir: string) => {
        await assertAllowedDir(dir)
        await git.cloneRepo(url, dir)
    },
    openRepo: git.openRepo,
    repoStatus: git.repoStatus,
    initRepo: git.initRepo,
    listDocs: git.listDocs,
    readDoc: git.readDoc,
    writeDoc: git.writeDoc,
    createDoc: git.createDoc,
    moveDoc: docOps.moveDoc,
    copyDoc: docOps.copyDoc,
    copyDocToRepo: async (dir: string, path: string, destDir: string) => {
        await assertAllowedDir(destDir)
        return docOps.copyDocToRepo(dir, path, destDir)
    },
    deleteDoc: docOps.deleteDoc,
    showDocInFolder: async (dir: string, path: string) => {
        if (typeof path !== 'string') throw new Error('文書を指定してください')
        shell.showItemInFolder(git.safeJoin(dir, path))
    },
    repoActivity: repoHome.repoActivity,
    scheduleAll: schedule.scheduleAll,
    readRepoNote: repoHome.readRepoNote,
    saveRepoNote: repoHome.saveRepoNote,
    log: git.log,
    lastChange: git.lastChange,
    readAt: git.readAt,
    saveVersion: async (dir: string, input: Parameters<typeof git.saveVersion>[1]) => {
        const oid = await git.saveVersion(dir, input)
        await issues.afterSave(dir, oid).catch((e) => console.error('[issues]', e))
        return oid
    },
    listIssues: issues.listIssues,
    issueDetail: issues.issueDetail,
    createIssue: issues.createIssue,
    updateIssue: issues.updateIssue,
    linkIssue: issues.linkIssue,
    closeIssue: issues.closeIssue,
    commentIssue: issues.commentIssue,
    branchIssues: issues.branchIssues,
    setBranchIssues: issues.setBranchIssues,
    pendingLocalIssues: issues.pendingLocalIssues,
    moveIssuesToForge: issues.moveIssuesToForge,
    discardChanges: git.discardChanges,
    sync: git.sync,
    push: git.push,
    publishRepo: git.publishRepo,
    changeRemote: git.changeRemote,
    disconnectRemote: git.disconnectRemote,
    resolveConflicts: git.resolveConflicts,
    listBranches: git.listBranches,
    createBranch: git.createBranch,
    switchBranch: git.switchBranch,
    previewMerge: git.previewMerge,
    mergeBranch: wf.adoptOrMerge,
    deleteBranch: git.deleteBranch,
    exportFile: async (req) => {
        if (req?.dir) await assertAllowedDir(req.dir)
        return keepExported(await exportFile(win, req))
    },
    previewPdf: async (source, style, base) => {
        if (base?.dir) await assertAllowedDir(base.dir)
        return previewPdf(source, style, base)
    },
    saveImage,
    proofread,
    updateState,
    checkUpdate,
    downloadUpdate,
    installUpdate,
    editCommand: (cmd: unknown) => {
        const wc = win?.webContents
        if (!wc) return
        if (cmd === 'cut') wc.cut()
        else if (cmd === 'copy') wc.copy()
        else if (cmd === 'paste') wc.paste()
        else if (cmd === 'selectAll') wc.selectAll()
    },
    listEffective: git.listEffective,
    addEffective: git.addEffective,
    removeEffective: git.removeEffective,
    listFolderStyles: fstyle.listFolderStyles,
    saveFolderStyle: fstyle.saveFolderStyle,
    setZoom: async (percent: number) => win?.webContents.setZoomFactor(Math.min(1.5, Math.max(0.75, percent / 100))),
    getRules: wf.getRules,
    saveRules: wf.saveRules,
    forgeKind: wf.forgeKind,
    listReviews: wf.listReviews,
    addReview: wf.addReview,
    occurrences: schedule.occurrences,
    occurrencesAll: schedule.occurrencesAll,
    exportSchedule: async (dir, today) => {
        if (dir) await assertAllowedDir(dir)
        const r = await exportScheduleIcs(win, dir, today)
        if (r) keepExported(r.path)
        return r
    },
    listEvents: schedule.listEvents,
    saveEvent: schedule.saveEvent,
    deleteEvent: schedule.deleteEvent,
    setEventDone: schedule.setEventDone,
    getEventKinds: schedule.getEventKinds,
    saveEventKinds: schedule.saveEventKinds,
    listDeliveries: wf.listDeliveries,
    deliver: (dir, input) => deliverWithDialog(win, dir, input),
    openPath: openFolder,
    openExported: async (p: unknown) => {
        const err = await shell.openPath(exportedPath(p))
        if (err) throw new Error(err)
    },
    showExported: async (p: unknown) => shell.showItemInFolder(exportedPath(p)),
    openExternal: async (url: string) => {
        if (url.startsWith('https://') || url.startsWith('mailto:')) await shell.openExternal(url)
    },
    getLicenses: async () => {
        try {
            return JSON.parse(await readFile(resolve(import.meta.dirname, '../licenses.json'), 'utf8'))
        } catch {
            return null
        }
    },
    accounts: accounts.accounts,
    identity: async (dir: unknown) => {
        if (dir) await assertAllowedDir(dir)
        return identity(typeof dir === 'string' ? dir : null)
    },
    loginStart: async (base: string) => {
        const info = await accounts.loginStart(base)
        if (info.verificationUri.startsWith('https://')) await shell.openExternal(info.verificationUri)
        return info
    },
    loginWait: accounts.loginWait,
    logout: accounts.logout,
    aiStatus,
    setAiKey,
    setAiConfig,
    listAiModels: (config: AiConfig) => listAiModels(cleanAiConfig(config)),
    aiLoginOpenRouter: async () => {
        const key = await loginOpenRouter((url) => shell.openExternal(url))
        await saveSecret('ai-key-openrouter', key)
        return aiStatus()
    },
    testAi,
    getMcpToken: mcpToken,
    desktopStatus,
    registerDesktop,
    unregisterDesktop,
    regenerateMcpToken: async () => {
        const token = await regenerateMcpToken()
        await applyMcp((await loadSettings()).mcp, notifyChanged('mcp'))
        return token
    },
    setMcp: async (config: McpConfig) => {
        const port = Math.trunc(Number(config?.port))
        if (!(port >= 1024 && port <= 65535)) throw new Error('ポート番号は 1024〜65535 で指定してください')
        const mcp = { enabled: !!config.enabled, port }
        await updateSettings((s) => ({ ...s, mcp }))
        await applyMcp(mcp, notifyChanged('mcp'))
        return aiStatus()
    },
    aiRun: (dir, input) => aiRun(dir, input, (e) => win?.webContents.send('aiEvent', e), notifyChanged('ai')),
    aiStop,
    aiReset,
}

for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(name, async (e, ...args) => {
        const from = e.senderFrame?.url ?? ''
        const dev = process.env.ELECTRON_RENDERER_URL
        if (!from.startsWith('app://bundle/') && !(dev && from.startsWith(dev))) throw new Error('不正な呼び出しです')
        if (DIR_FIRST.has(name)) await assertAllowedDir(args[0])
        return LOCKED.has(name) ? withRepoLock(args[0], async () => fn(...args)) : fn(...args)
    })
}

void app.whenReady().then(() => {
    setAppMenu()
    serveRenderer()
    void createWindow()
    void listFonts()
    void loadSettings().then((s) => applyMcp(s.mcp, notifyChanged('mcp')))
    initUpdater((u) => win?.webContents.send('updateState', u))
    startReminders((e) => {
        if (!win) return
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
        win.webContents.send('openSchedule', e)
    })
    nativeTheme.on('updated', async () => applyTheme((await loadSettings()).theme))
})
app.on('window-all-closed', () => app.quit())
app.on('will-quit', stopProofread)
