import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { t } from '../shared/i18n'
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
import * as sign from './sign-service'
import * as signing from './signing'
import * as verify from './verify'
import { mynaStatus } from './myna'
import * as seals from './seals'
import * as policy from './policy'
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
import { SPELL_LANGS } from '../shared/legal-styles'
import { imageExt, imageMime } from '../shared/images'
import { setAppMenu } from './menu'
import { applyLocale, systemLanguages } from './i18n'
import { cspFor } from './csp'
import { aiReset, aiRun, aiStop, testAi } from './ai-agent'
import { keyName, resolveAi } from './ai/provider'
import { listAiModels } from './ai/models'
import { loginOpenRouter } from './ai/openrouter-auth'
import { aiBaseOf, cleanAiConfig, type AiConfig, type AiProvider } from '../shared/ai-providers'
import { isEnabled } from '../shared/experiments'
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

async function serveRepoImage(pathname: string): Promise<Response> {
    const [encDir, ...rest] = pathname.slice('/__repo/'.length).split('/')
    try {
        const dir = decodeURIComponent(encDir)
        const path = rest.map((s) => decodeURIComponent(s)).join('/')
        const ext = imageExt(path)
        if (!ext) return new Response('Forbidden', { status: 403 })
        await assertAllowedDir(dir)
        const full = git.safeJoin(dir, path)
        if (!statSync(full, { throwIfNoEntry: false })?.isFile()) return new Response('Not Found', { status: 404 })
        const res = await net.fetch(pathToFileURL(full).toString())
        return new Response(res.body, {
            status: res.status,
            headers: { 'Content-Type': imageMime(ext), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" },
        })
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
        if (file.endsWith('.html')) {
            const html = await readFile(file, 'utf8')
            return new Response(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': cspFor(html), 'X-Content-Type-Options': 'nosniff' },
            })
        }
        const res = await net.fetch(pathToFileURL(file).toString())
        const headers = new Headers(res.headers)
        headers.set('X-Content-Type-Options', 'nosniff')
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
const CASE_FOLD = process.platform === 'win32' || process.platform === 'darwin'
const norm = (p: string) => (CASE_FOLD ? resolve(p).toLowerCase() : resolve(p))
const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)

async function assertAllowedDir(dir: unknown, allowPicked = false): Promise<void> {
    if (typeof dir !== 'string' || !dir) throw new Error(t().errors.app.noRepo)
    const d = norm(dir)
    const { repos } = await loadSettings()
    if (repos.some((r) => norm(r.dir) === d)) return
    if (allowPicked && [...pickedRoots].some((root) => under(d, root))) return
    throw new Error(t().errors.app.notRegistered)
}

const PICKED_OK = new Set(['openRepo', 'initRepo'])
const DOC_PATH = new Set(['readDoc', 'writeDoc', 'createDoc', 'discardChanges'])

function assertPicked(dir: unknown) {
    if (typeof dir !== 'string' || ![...pickedRoots].some((root) => under(norm(dir), root))) throw new Error(t().errors.app.repickFolder)
}

const DIR_FIRST = new Set([
    'verifyCommits',
    'publishSigningKey',
    'policyStatus',
    'signLegacyRules',
    'proposePolicy',
    'cosignPolicy',
    'acceptGenesisChange',
    'forgePublicKeys',
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
    const config = cleanAiConfig({ provider, baseUrl }, { lan: isEnabled(await loadSettings(), 'lanAi') })
    const name = keyName(config.provider, aiBaseOf(config))
    if (!name) throw new Error(t().errors.app.noKeyForProvider)
    await saveSecret(name, typeof key === 'string' ? key.trim() : '')
    return aiStatus()
}

async function setAiConfig(config: AiConfig): Promise<AiStatus> {
    await updateSettings((s) => ({ ...s, ai: cleanAiConfig(config, { lan: isEnabled(s, 'lanAi') }) }))
    return aiStatus()
}

const exported = new Set<string>()
function keepExported<T extends string | null>(p: T): T {
    if (p) exported.add(resolve(p))
    return p
}
function exportedPath(p: unknown): string {
    const full = typeof p === 'string' ? resolve(p) : ''
    if (!exported.has(full) || !statSync(full, { throwIfNoEntry: false })?.isFile()) throw new Error(t().errors.app.fileNotFound)
    return full
}

const BUNDLE_RE =
    /\.(app|bundle|framework|plugin|kext|prefpane|workflow|action|saver|scptd|pkg|mpkg|qlgenerator|mdimporter|component|wdgt|xpc|appex|service|command|tool|terminal|scpt)$/i
const madeFolders = new Set<string>()

function isBundle(full: string): boolean {
    if (full.split(sep).some((part) => BUNDLE_RE.test(part))) return true
    return existsSync(join(full, 'Contents', 'Info.plist')) || existsSync(join(full, 'Info.plist'))
}

async function openFolder(p: unknown): Promise<void> {
    if (typeof p !== 'string' || !(process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : isAbsolute(p))) throw new Error(t().errors.app.cannotOpen)
    const full = resolve(p)
    if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) throw new Error(t().errors.app.folderNotFound)
    if (isBundle(full)) throw new Error(t().errors.app.cannotOpen)
    const { repos } = await loadSettings()
    if (madeFolders.has(norm(full)) || repos.some((r) => norm(r.dir) === norm(full))) await shell.openPath(full)
    else shell.showItemInFolder(full)
}

const handlers: Record<string, (...args: any[]) => unknown> = {
    getSettings: loadSettings,
    setTheme: async (theme: AppSettings['theme']) => {
        await updateSettings((s) => ({ ...s, theme }))
        await applyTheme(theme)
    },
    platform: async () => process.platform,
    systemLanguages: async () => systemLanguages(),
    listFonts,
    saveSettings: async (next: AppSettings) => {
        for (const r of next.repos ?? []) await assertAllowedDir(r.dir, true)
        const kept = new Set((next.repos ?? []).map((r) => norm(r.dir)))
        await updateSettings((cur) => {
            for (const r of cur.repos ?? []) if (!kept.has(norm(r.dir))) git.forgetRepo(r.dir)
            return { ...next, mcp: cur.mcp, ai: cur.ai }
        })
        applyLocale(await loadSettings())
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
        await assertAllowedDir(dir, true)
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
        if (typeof path !== 'string') throw new Error(t().errors.app.docRequired)
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
    signingStatus: async (dir) => {
        if (dir) await assertAllowedDir(dir)
        return sign.signingStatus(dir)
    },
    setSigningPrefs: (patch) => sign.setSigningPrefs(patch),
    generateSigningKey: async () => {
        await signing.generateSigningKey()
        return sign.signingStatus()
    },
    deleteSigningKey: async () => {
        await signing.deleteSigningKey()
        return sign.signingStatus()
    },
    registerSigningKey: (base) => verify.registerSigningKey(String(base)),
    testExternalSigning: async (dir) => {
        if (dir) await assertAllowedDir(dir)
        return signing.testExternalSigning(dir)
    },
    importPdfCert: (data, password) => sign.importPdfCert(data, password),
    createSelfSignedCert: (opts) => sign.createSelfSignedCert(opts),
    removePdfCert: () => sign.removePdfCert(),
    exportPdfCert: () => sign.exportPdfCert(win),
    setTsaPassword: (password) => sign.setTsaPassword(password),
    testTimestamp: () => sign.testTimestamp(),
    mynaStatus: () => mynaStatus(),
    publishSigningKey: async (dir) => {
        await assertAllowedDir(dir)
        return wf.publishSigningKey(dir)
    },
    listSeals: () => seals.listSeals(),
    saveSeal: (meta, png) => seals.saveSeal(meta, png),
    readSeal: (id) => seals.readSeal(id),
    deleteSeal: (id) => seals.deleteSeal(id),
    policyStatus: async (dir) => {
        await assertAllowedDir(dir)
        return policy.policyStatus(dir)
    },
    signLegacyRules: async (dir) => {
        await assertAllowedDir(dir)
        return policy.signLegacyRules(dir)
    },
    proposePolicy: async (dir, draft) => {
        await assertAllowedDir(dir)
        return policy.proposePolicy(dir, draft)
    },
    cosignPolicy: async (dir, file) => {
        await assertAllowedDir(dir)
        return policy.cosignPolicy(dir, String(file))
    },
    acceptGenesisChange: async (dir) => {
        await assertAllowedDir(dir)
        return policy.acceptGenesisChange(dir)
    },
    forgePublicKeys: async (dir, login) => {
        await assertAllowedDir(dir)
        return verify.forgePublicKeys(dir, String(login))
    },
    verifyCommits: async (dir, oids) => {
        await assertAllowedDir(dir)
        return verify.verifyCommits(dir, Array.isArray(oids) ? oids.map(String) : [])
    },
    previewPdf: async (source, style, base) => {
        if (base?.dir) await assertAllowedDir(base.dir)
        return previewPdf(source, style, base)
    },
    saveImage,
    proofread,
    setSpellLanguages: (langs: unknown) => {
        if (process.platform === 'darwin' || !win || !Array.isArray(langs)) return
        const session = win.webContents.session
        const wanted = langs.filter((l): l is string => typeof l === 'string' && (SPELL_LANGS as readonly string[]).includes(l))
        const usable = wanted.filter((l) => session.availableSpellCheckerLanguages.includes(l))
        if (usable.length && usable.join() !== session.getSpellCheckerLanguages().join()) session.setSpellCheckerLanguages(usable)
    },
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
    listDeliveries: async (dir: string, docPath?: string) => {
        const list = await wf.listDeliveries(dir, docPath)
        for (const d of list) if (d.folder) madeFolders.add(norm(d.folder))
        return list
    },
    deliver: async (dir, input) => {
        const rec = await deliverWithDialog(win, dir, input)
        if (rec?.folder) madeFolders.add(norm(rec.folder))
        return rec
    },
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
    listAiModels: async (config: AiConfig) => listAiModels(cleanAiConfig(config, { lan: isEnabled(await loadSettings(), 'lanAi') })),
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
        if (!(port >= 1024 && port <= 65535)) throw new Error(t().errors.app.badPort)
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
        if (!from.startsWith('app://bundle/') && !(dev && from.startsWith(dev))) throw new Error(t().errors.app.badCaller)
        if (DIR_FIRST.has(name)) await assertAllowedDir(args[0], PICKED_OK.has(name))
        if (DOC_PATH.has(name)) git.assertDocPath(args[1])
        return LOCKED.has(name) ? withRepoLock(args[0], async () => fn(...args)) : fn(...args)
    })
}

void app.whenReady().then(async () => {
    applyLocale(await loadSettings())
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
