import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import electronPath from 'electron'
import { addDays } from '../../src/shared/schedule'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const repos: { name: string; dir: string }[] = []
vi.mock('../../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos, author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))
const git = await import('../../src/main/git')
const sch = await import('../../src/main/schedule')

const DOC = '就業規則.md'
const p = (n: number) => String(n).padStart(2, '0')
const d = new Date()
const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`

let tmp = ''
let dir = ''
let overdueId = ''
let app: ElectronApplication
let win: Page
const errors: string[] = []

const store = (code: string) => win.evaluate(`(() => { const s = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('app'); ${code} })()`)
const seen = (text: string) => win.getByText(text).filter({ visible: true }).first().waitFor()

beforeAll(async () => {
    if (!fs.existsSync(join(ROOT, 'out/main/index.js'))) throw new Error('先に npm run build でアプリをビルドしてください')
    tmp = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-e2e-'))
    dir = join(tmp, 'テスト社_規程')
    fs.mkdirSync(dir)
    repos.push({ name: 'テスト社_規程', dir })

    await git.initRepo(dir)
    await git.createDoc(dir, DOC, '就業規則')
    await git.saveVersion(dir, { message: '初版', effectiveDate: addDays(today, 30), docPath: DOC })
    overdueId = (await sch.saveEvent(dir, { kind: 'submit', title: '規程の提出', docPath: DOC, date: addDays(today, -10) })).id
    await sch.saveEvent(dir, { kind: 'notify', title: '労基署への届出', docPath: DOC, date: addDays(today, 14) })

    const userData = join(tmp, 'user-data')
    fs.mkdirSync(userData)
    const settings = {
        repos,
        author: { name: 'テスト', email: 't@example.com' },
        username: 'x-access-token',
        current: dir,
        prefs: { syncOnStart: false, notifyDue: false, reopenLastDoc: false, opening: false },
    }
    fs.writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings), 'utf8')

    // VS Code のターミナルなどで ELECTRON_RUN_AS_NODE が付いていると、Electron が Node として動いてアプリが起動しない
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>
    // アプリの場所は「.」で渡す。ROOT は末尾が「\」で、Windows ではそれが引用符の終わりと読まれ、次の引数とつながるため
    app = await _electron.launch({ executablePath: electronPath as unknown as string, args: ['.', `--user-data-dir=${userData}`], cwd: ROOT, env })
    win = await app.firstWindow()
    win.on('pageerror', (e) => errors.push(e.message))
    await win.setViewportSize({ width: 1280, height: 800 })
    await win.getByText('これからの期日').first().waitFor({ timeout: 60000 })
})

afterAll(async () => {
    await app?.close().catch(() => { })
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

describe('画面', () => {
    it('トップページに、すべてのリポジトリの期日（期限切れとこれから）が出る', async () => {
        await win.getByText('規程の提出').first().waitFor({ state: 'visible', timeout: 10000 })
        await win.getByText('労基署への届出').first().waitFor({ state: 'visible', timeout: 10000 })
    })

    it('左のペインをすべてのリポジトリの期日に切り替え、一覧から済みにすると記録に残る', async () => {
        await win.getByRole('radio', { name: 'すべてのリポジトリの期日' }).click()
        await win.getByRole('button', { name: 'カレンダーに書き出す' }).waitFor()
        await win.getByRole('radio', { name: '一覧' }).click()
        await win.getByRole('checkbox', { name: '済みにする' }).first().click()
        await expect.poll(async () => (await sch.listEvents(dir)).find((e) => e.id === overdueId)?.done, { timeout: 10000 }).toEqual([addDays(today, -10)])
        await win.getByRole('radio', { name: 'タイムライン' }).click()
        await win.getByRole('radio', { name: '最近開いた文書' }).click()
    })

    it('リポジトリ・編集・改定履歴・新旧対照表・期日・納品・期日の画面を開ける', async () => {
        await store(`s.view = 'docs'`)
        await seen('就業規則')
        await store(`s.openDoc(${JSON.stringify(DOC)})`)
        await win.locator('.cm-editor').first().waitFor()
        await expect(win.locator('.cm-content').first().textContent()).resolves.toContain('就業規則')
        for (const v of ['history', 'compare', 'releases']) {
            await store(`s.view = '${v}'`)
            await win.waitForTimeout(500)
        }
        await store(`s.openSchedule()`)
        await win.getByRole('button', { name: '期日を足す' }).first().waitFor()
        await expect(win.getByText('労基署への届出').first().isVisible()).resolves.toBe(true)
    })

    it('アプリの設定とリポジトリの設定（期日の種類）を開ける', async () => {
        await store(`s.openSettings('setup', 'due')`)
        await seen('期日をデスクトップに通知する')
        await store(`s.openSettings('repo', 'kinds')`)
        await win.getByRole('button', { name: '種類を足す' }).waitFor()
    })

    it('ここまでの画面でエラーが出ていない', () => {
        expect(errors).toEqual([])
    })
})
