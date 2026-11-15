import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/api'
import { appBundleOf, BREW_UPGRADE, brewFailure, brewUpgradeScript, isBrewInstall } from './brew'

const { autoUpdater } = electronUpdater

const VIA: UpdateState['via'] = process.platform === 'darwin' && app.isPackaged && isBrewInstall(process.execPath) ? 'brew' : undefined

let state: UpdateState = { state: 'idle', current: app.getVersion(), via: VIA }
let notify: (s: UpdateState) => void = () => {}
let ready = false

const MANUAL = process.platform === 'darwin' && !VIA
const brewLog = () => path.join(app.getPath('userData'), 'update.log')
const RELEASES_URL = 'https://github.com/SHIOZAKI-Shota/ClauseDown/releases/latest'

function set(next: Omit<UpdateState, 'current' | 'via'>) {
    state = { ...next, current: app.getVersion(), via: VIA }
    notify(state)
}

function notesOf(info: UpdateInfo): string {
    const raw = info.releaseNotes
    const text = Array.isArray(raw) ? raw.map((n) => `${n.version}\n${n.note ?? ''}`).join('\n\n') : (raw ?? '')
    return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|li|h\d)>/gi, '\n')
        .replace(/<li>/gi, '・')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

const date = (info: UpdateInfo) => (info.releaseDate ? info.releaseDate.slice(0, 10) : undefined)

function setup() {
    if (ready) return
    ready = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null
    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
    autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version, notes: notesOf(info), date: date(info) }))
    autoUpdater.on('update-not-available', () => set({ state: 'latest' }))
    autoUpdater.on('download-progress', (p) =>
        set({ state: 'downloading', version: state.version, notes: state.notes, date: state.date, percent: Math.round(p.percent) }),
    )
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, notes: state.notes || notesOf(info), date: date(info) }))
    autoUpdater.on('error', (e) => set({ state: 'error', version: state.version, message: friendly(e) }))
}

function friendly(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(m)) return 'インターネットにつながらないため、更新を確認できませんでした'
    if (/404|latest(-mac)?\.yml/i.test(m)) return '配布されている更新の情報が見つかりませんでした'
    return `更新でエラーが起きました：${m.split('\n')[0]}`
}

export function initUpdater(send: (s: UpdateState) => void) {
    notify = send
    if (!VIA) return
    let log: string
    try {
        log = fs.readFileSync(brewLog(), 'utf8')
        fs.rmSync(brewLog(), { force: true })
    } catch {
        return
    }
    const failure = brewFailure(log)
    if (failure) set({ state: 'error', message: `Homebrew での更新に失敗しました：${failure}。ターミナルで「${BREW_UPGRADE}」を実行してください` })
}

export const updateState = (): UpdateState => state

export async function checkUpdate(): Promise<UpdateState> {
    if (!app.isPackaged) {
        set({ state: 'dev' })
        return state
    }
    if (state.state === 'downloading' || state.state === 'ready' || state.state === 'checking') return state
    setup()
    set({ state: 'checking' })
    try {
        await autoUpdater.checkForUpdates()
    } catch (e) {
        set({ state: 'error', message: friendly(e) })
    }
    return state
}

export async function downloadUpdate(): Promise<UpdateState> {
    if (state.state !== 'available' && state.state !== 'error') return state
    if (!state.version) return state
    if (MANUAL) {
        await shell.openExternal(RELEASES_URL)
        return state
    }
    if (VIA) {
        set({ state: 'ready', version: state.version, notes: state.notes, date: state.date })
        return state
    }
    setup()
    set({ state: 'downloading', version: state.version, notes: state.notes, date: state.date, percent: 0 })
    try {
        await autoUpdater.downloadUpdate()
    } catch (e) {
        set({ state: 'error', version: state.version, message: friendly(e) })
    }
    return state
}

export function installUpdate() {
    if (state.state !== 'ready') return
    if (VIA) {
        const bundle = appBundleOf(process.execPath)
        if (!bundle) return
        spawn('/bin/sh', ['-c', brewUpgradeScript(process.pid, bundle, brewLog())], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}` },
        }).unref()
        setImmediate(() => app.quit())
        return
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
