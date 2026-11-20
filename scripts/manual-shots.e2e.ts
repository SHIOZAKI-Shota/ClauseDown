// 英語版マニュアル（docs/manual/en）の画面写真を撮る。
// npm run manual:shots で、ビルドしたアプリを英語で起動し、見本のリポジトリを作って docs/manual/en/images/ に保存する。
// 一部だけ撮り直すときは SHOTS=home,editor のように名前を並べる（見本づくりは毎回行う）。
// 外部のサイトの画像（gh-*・gl-*）は撮れないので、日本語版の画像をそのまま写す。
import { afterAll, beforeAll, describe, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Locator, type Page } from 'playwright-core'
import electronPath from 'electron'
import { createSoftwareAuthenticator, generateEd25519, signDocument } from '@mdsig/core'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'scripts/manual-shots')
const JA_IMAGES = join(ROOT, 'docs/manual/images')
const OUT = join(ROOT, 'docs/manual/en/images')
const ONLY = (process.env.SHOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const COPIED = ['gh-create.png', 'gh-create2.png', 'gh-repos-select.jpg', 'gl-create.png', 'gl-create2.png', 'gl-device.jpg']

const ME = { name: 'Alex Morgan', email: 'alex@example.com' }
const PEOPLE: Record<string, string> = { 'Alex Morgan': 'alex@example.com', 'Jordan Lee': 'jordan@example.com', 'Sam Patel': 'sam@example.com' }
const repos: { name: string; dir: string; url?: string; section?: string }[] = []

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    listCredentials: async () => [],
    loadSettings: async () => ({ repos, author: ME, username: '', prefs: {} }),
}))
const { setLocale } = await import('../src/shared/i18n')
setLocale('en')
const git = await import('../src/main/git')
const records = await import('../src/main/records')
const issues = await import('../src/main/issues')
const iso = (await import('../src/main/igit')).default

const pad = (n: number) => String(n).padStart(2, '0')
const iso8601 = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = iso8601(new Date())
const fromToday = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return iso8601(d)
}
const source = (name: string) => fs.readFileSync(join(SRC, name), 'utf8')

// ---------- 見本のリポジトリ ----------

const sig = (who: string, date: string) => ({
    name: who,
    email: PEOPLE[who],
    timestamp: Math.floor(new Date(`${date}T10:00:00`).getTime() / 1000),
    timezoneOffset: new Date(`${date}T10:00:00`).getTimezoneOffset(),
})
const atOf = (date: string) => new Date(`${date}T10:00:00`).toISOString().replace(/\.\d{3}Z$/, 'Z')

class Sample {
    private seq = 0
    constructor(readonly dir: string) {}

    async init() {
        fs.mkdirSync(this.dir, { recursive: true })
        await iso.init({ fs, dir: this.dir, defaultBranch: 'main' })
    }

    write(path: string, text: string) {
        const full = join(this.dir, ...path.split('/'))
        fs.mkdirSync(dirname(full), { recursive: true })
        fs.writeFileSync(full, text, 'utf8')
    }

    read(path: string) {
        return fs.readFileSync(join(this.dir, ...path.split('/')), 'utf8')
    }

    edit(path: string, from: string, to: string) {
        const text = this.read(path)
        if (!text.includes(from)) throw new Error(`${path} に「${from}」がありません`)
        this.write(path, text.replace(from, to))
    }

    async save(date: string, message: string, who: string, effective?: string, docs: string[] = []) {
        const { dir } = this
        for (const [path, head, work, stage] of await iso.statusMatrix({ fs, dir })) {
            if (work === 0) await iso.remove({ fs, dir, filepath: path })
            else if (head !== work || work !== stage) await iso.add({ fs, dir, filepath: path })
        }
        const s = sig(who, date)
        const oid = await iso.commit({ fs, dir, message: effective ? `${message}\n\n施行日: ${effective}` : message, author: s, committer: s })
        for (const d of effective ? docs : []) {
            await iso.annotatedTag({
                fs,
                dir,
                ref: `施行/${d.replace(/\.md$/, '')}/${effective}`,
                message: `${d} effective ${effective}`,
                tagger: s,
                object: oid,
                force: true,
            })
        }
        return oid
    }

    async draft(label: string, date: string, who: string, edits: [string, string, string][], message: string, request?: string) {
        const { dir } = this
        const ref = git.draftRef(label)
        await iso.branch({ fs, dir, ref, checkout: true })
        for (const [p, from, to] of edits) this.edit(p, from, to)
        const oid = await this.save(date, message, who)
        if (request) await this.record('reviews', { branch: ref, action: 'request', oid, by: who, at: atOf(date), text: request, source: 'app' }, date)
        await iso.checkout({ fs, dir, ref: 'main' })
        return ref
    }

    async record(folder: string, data: Record<string, unknown>, date = TODAY) {
        const id = `${atOf(date)
            .replace(/[-:TZ]/g, '')
            .slice(0, 14)}-en${String(++this.seq).padStart(4, '0')}`
        await records.writeRecord(this.dir, `${folder}/${id}.json`, { id, ...data })
        return id
    }

    async issue(n: number, title: string, body: string, author: string, date: string, o: { closed?: string } = {}) {
        return this.record(
            'issues',
            {
                n,
                title,
                body,
                state: o.closed ? 'closed' : 'open',
                author,
                createdAt: atOf(date),
                links: [],
                ...(o.closed ? { closedAt: atOf(o.closed) } : {}),
            },
            date,
        )
    }

    event(
        e: { kind: string; title: string; docPath: string; date: string; end?: string; repeat?: { every: 'year' | 'month' }; done?: string[] },
        by = 'Jordan Lee',
        at = '2026-10-20',
    ) {
        return this.record('events', { done: [], by, at: atOf(at), updatedAt: atOf(at), ...e }, at)
    }
}

const HANDBOOK = 'employee-handbook.md'
const BEREAVE_OLD = '  - Upon the death of a sibling, grandparent, or parent or sibling of the spouse: 2 days\n'
const AMENDED_2026 =
    '\n\n## Supplementary Provisions (Amended April 1, 2026) {supplement}\n\n### Effective Date\n- These amendments take effect on April 1, 2026.\n'
const MSA = 'services/master-services-agreement.md'
const NDA = 'nda/mutual-nda.md'
const LICENSE = 'licensing/software-license-agreement.md'
const ENERGY = 'energy-efficiency-grants.md'
const REPAIR = 'home-repair-grants.md'

let tmp = ''
const dirs = { rules: '', contracts: '', city: '', houritsu: '', beta: '' }
const oids = { v2: '' }

async function seedRules(dir: string) {
    const r = new Sample(dir)
    await r.init()
    const final = source(HANDBOOK)
    r.write(
        HANDBOOK,
        final
            .replace('up to 5 days of leave per year', 'up to 3 days of leave per year')
            .replace('up to $500 per month', 'up to $300 per month')
            .replace(AMENDED_2026, '\n'),
    )
    await r.save('2025-02-03', 'Create the handbook based on the model work rules', 'Jordan Lee', '2025-04-01', [HANDBOOK])
    r.write(HANDBOOK, final)
    oids.v2 = await r.save('2026-02-10', 'Raise fertility treatment leave and the commuting allowance cap', 'Sam Patel', '2026-04-01', [HANDBOOK])
    await r.draft(
        'April-2027-revision',
        '2026-10-20',
        'Sam Patel',
        [
            [HANDBOOK, BEREAVE_OLD, `${BEREAVE_OLD}  - When the employee's child starts elementary school: 1 day\n`],
            [
                HANDBOOK,
                AMENDED_2026,
                `${AMENDED_2026}\n## Supplementary Provisions (Amended April 1, 2027) {supplement}\n\n### Effective Date\n- These amendments take effect on April 1, 2027.\n`,
            ],
        ],
        "Add bereavement leave for a child's school entry",
        'Added a day of leave when a child starts elementary school. Please review.',
    )
    const draft = git.draftRef('April-2027-revision')
    await records.writeRecord(dir, 'settings/rules.json', { requireApproval: true, approvers: [ME.name] })
    await r.issue(1, 'Clarify the probationary period rules', 'Spell out whether the probationary period can be extended.', 'Sam Patel', '2026-11-02', {
        closed: '2026-11-05',
    })
    await r.issue(2, 'State the harassment consultation desk', 'Add where employees can report harassment.', 'Sam Patel', '2026-11-12')
    const school = await r.issue(
        3,
        "Add bereavement leave for a child's school entry",
        'Requested in the employee survey.\n\n- Event: starting elementary school\n- Days: 1',
        'Sam Patel',
        '2026-11-12',
    )
    await r.issue(
        4,
        'Reflect the amended family care leave rules',
        'Check the separate rules on parental and family care leave against the new law.',
        'Sam Patel',
        '2026-11-12',
    )
    await r.record(
        'issue-comments',
        {
            issue: school,
            body: 'I added this to 5.6 (Bereavement Leave) in the draft "April-2027-revision". Please review.',
            by: 'Sam Patel',
            at: atOf('2026-11-12'),
        },
        '2026-11-12',
    )
    await r.record(
        'issue-comments',
        {
            issue: school,
            body: 'One day is **fine**.\nWe will consider middle school entry in the next revision.',
            by: 'Alex Morgan',
            at: new Date(new Date(`2026-11-12T10:05:00`)).toISOString(),
        },
        '2026-11-12',
    )
    await issues.setBranchIssues(dir, draft, [3])
    await r.event(
        { kind: 'notify', title: 'Notify employees of the 2026 revision', docPath: HANDBOOK, date: '2026-03-13', done: ['2026-03-13'] },
        'Alex Morgan',
        '2026-02-10',
    )
    await r.event({ kind: 'notify', title: 'Notify employees of the 2027 revision', docPath: HANDBOOK, date: '2027-03-12' }, 'Alex Morgan')
    await r.event(
        { kind: 'renew', title: 'Renew the overtime agreement', docPath: '', date: '2026-03-31', repeat: { every: 'year' }, done: ['2026-03-31'] },
        'Alex Morgan',
        '2026-02-10',
    )
    await r.event({ kind: 'deadline', title: 'Staff comments on the draft due', docPath: HANDBOOK, date: fromToday(-3) }, 'Alex Morgan')
    await r.event({ kind: 'submit', title: 'Submit the draft to the board', docPath: HANDBOOK, date: fromToday(14) }, 'Alex Morgan')
    // 今日、現行版で同じ条を直した版（改定案と重なる）
    r.edit(HANDBOOK, BEREAVE_OLD, BEREAVE_OLD.replace('2 days', '3 days'))
    await git.saveVersion(dir, { message: 'Change bereavement leave for the death of a sibling, etc. to 3 days', docPath: HANDBOOK })
    await r.record('deliveries', {
        docPath: HANDBOOK,
        title: 'Employee Handbook',
        client: '',
        oid: oids.v2,
        effectiveDate: '2026-04-01',
        to: 'Acme Corp. HR Department',
        memo: '',
        items: ['docPdf', 'docDocx', 'cmpPdf', 'cmpDocx'],
        files: ['Employee Handbook.pdf', 'Employee Handbook.docx'],
        folder: '',
        at: new Date().toISOString(),
        by: ME.name,
    })
}

async function seedContracts(dir: string) {
    const r = new Sample(dir)
    await r.init()
    const msa = source('master-services-agreement.md')
    const nda = source('mutual-nda.md')
    r.write(MSA, msa.replace('$3,000 per month', '$2,500 per month').replace('continue for three years after', 'continue for two years after'))
    r.write(NDA, nda.replace('survive for three years', 'survive for two years'))
    r.write(LICENSE, source('software-license-agreement.md'))
    await r.save('2026-02-16', 'Draft the services agreement, NDA and license agreement', 'Jordan Lee')
    r.write(MSA, msa)
    r.write(NDA, nda)
    await r.save('2026-03-18', 'Reflect negotiations with the counterparties (fees, confidentiality period)', 'Jordan Lee', '2026-04-01', [MSA, NDA])
    await r.draft('FY2027-renewal', '2026-11-02', 'Jordan Lee', [[MSA, '$3,000 per month', '$3,200 per month']], 'Revise the monthly fee for FY2027')
    await r.event({ kind: 'start', title: 'Services begin', docPath: MSA, date: '2026-04-01' })
    await r.event({ kind: 'end', title: 'Services term ends', docPath: MSA, date: '2027-03-31' })
    await r.event({ kind: 'deadline', title: 'Deadline for notice of non-renewal', docPath: MSA, date: '2027-02-28' })
    await r.event({ kind: 'deadline', title: 'Send the renewal fee proposal', docPath: MSA, date: fromToday(21) })
    await r.event({ kind: 'end', title: 'NDA expires', docPath: NDA, date: '2028-03-31' })
    await r.event({ kind: 'renew', title: 'License renewal', docPath: LICENSE, date: '2027-02-16' })
}

async function seedCity(dir: string) {
    const r = new Sample(dir)
    await r.init()
    const repair = source('home-repair-grants.md')
    r.write(REPAIR, repair.replace('up to $5,000', 'up to $3,000').replace('\n- The amendments to these Guidelines take effect on October 1, 2026.', ''))
    r.write(ENERGY, source('energy-efficiency-grants.md'))
    await r.save('2026-01-08', 'Create the grant guidelines', 'Jordan Lee', '2026-04-01', [REPAIR, ENERGY])
    r.write(REPAIR, repair)
    await r.save('2026-08-25', 'Raise the home repair grant cap to $5,000', 'Sam Patel', '2026-10-01', [REPAIR])
    await r.event({ kind: 'deadline', title: 'Public comment deadline', docPath: REPAIR, date: '2026-01-30', done: ['2026-01-30'] })
    await r.event({ kind: 'submit', title: 'Submit to the city council', docPath: REPAIR, date: '2026-02-20', done: ['2026-02-20'] })
    await r.event({ kind: 'deadline', title: 'Grant applications open', docPath: REPAIR, date: '2026-05-01', end: '2027-01-29' })
    await r.event({ kind: 'submit', title: 'Submit the 2027 amendments to the council', docPath: REPAIR, date: '2027-02-19' })
    await r.event({ kind: 'start', title: 'Public comment on the amendments', docPath: ENERGY, date: fromToday(7), end: fromToday(37) })
}

async function seedHouritsu(dir: string) {
    const r = new Sample(dir)
    await r.init()
    const base = join(ROOT, 'example_repository/houritsu')
    const walk = (d: string): string[] =>
        fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    for (const f of walk(base))
        r.write(
            f
                .slice(base.length + 1)
                .split(/[\\/]/)
                .join('/'),
            fs.readFileSync(f, 'utf8'),
        )
    await r.save('2026-11-01', 'Fetch 3 statutes from houritsu', 'Jordan Lee')
}

async function seedBeta(dir: string) {
    const r = new Sample(dir)
    await r.init()
    r.write('work-rules.md', source('work-rules.md'))
    await r.save('2026-11-12', 'First version', 'Alex Morgan')
    const one = await r.issue(1, 'Make Saturdays a day off', 'Review the days off in Section 2.', 'Alex Morgan', '2026-11-12')
    await r.issue(2, 'Add retirement provisions', 'Add sections on the retirement age and resignation.', 'Alex Morgan', '2026-11-12')
    await r.record(
        'issue-comments',
        { issue: one, body: "Checking with the client's HR department whether Saturdays can be days off.", by: 'Alex Morgan', at: atOf('2026-11-12') },
        '2026-11-12',
    )
    await r.record(
        'issue-comments',
        {
            issue: one,
            body: 'Decided at the 11/20 meeting:\n\n- **Saturdays and Sundays** are days off\n- Public holidays to be handled separately',
            by: 'Alex Morgan',
            at: new Date('2026-11-12T10:05:00').toISOString(),
        },
        '2026-11-12',
    )
}

// ---------- アプリ ----------

let app: ElectronApplication
let win: Page
const failed: string[] = []

const store = (code: string) =>
    win.evaluate(`(async () => { const s = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$pinia._s.get('app'); ${code} })()`)
const seen = (text: string | RegExp, timeout = 15000) => win.getByText(text).filter({ visible: true }).first().waitFor({ timeout })
const wait = (ms: number) => win.waitForTimeout(ms)

async function viewport(width = 1920, height = 1200) {
    await win.setViewportSize({ width, height })
    await wait(300)
}

interface ShotOptions {
    clip?: { x: number; y: number; width: number; height: number }
    locator?: Locator
    hi?: boolean
}
async function save(name: string, o: ShotOptions = {}) {
    if (!want(name)) return
    await wait(400)
    const path = join(OUT, name)
    const scale = o.hi ? 'device' : 'css'
    if (o.locator) await o.locator.screenshot({ path, scale, animations: 'disabled' })
    else await win.screenshot({ path, scale, clip: o.clip, animations: 'disabled' })
}

async function reset() {
    for (let i = 0; i < 3; i++) {
        await win.keyboard.press('Escape').catch(() => {})
        await wait(150)
    }
    await store(`s.dialog = null; s.paletteOpen = false`)
    await wait(200)
}

async function openDoc(dir: string, path: string, view = 'editor') {
    await store(
        `if (s.repoDir !== ${JSON.stringify(dir)}) await s.switchRepo(${JSON.stringify(dir)}); s.openDoc(${JSON.stringify(path)}, ${JSON.stringify(view)})`,
    )
    if (view === 'editor') {
        await win.locator('.cm-content').first().waitFor()
        // AI のパネルは開いたままになるので、撮る画面ごとに閉じておく
        if (await win.locator('aside.ai-panel').count()) await win.getByRole('button', { name: 'AI', exact: true }).first().click()
    }
    await wait(800)
}

async function repoHome(dir: string) {
    await store(`if (s.repoDir !== ${JSON.stringify(dir)}) await s.switchRepo(${JSON.stringify(dir)}); s.view = 'docs'`)
    await wait(1200)
}

// 続けて撮る画面（同じ状態から何枚も撮るもの）は、名前を並べて 1 つにする
const shots: { names: string[]; fn: () => Promise<void> }[] = []
const shot = (names: string | string[], fn: () => Promise<void>) => shots.push({ names: [names].flat(), fn })

// ---------- 撮る画面 ----------

shot('home.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await store(`s.homeTab = 'recent'; s.view = 'home'`)
    await wait(1500)
    await save('home.png')
})

shot('home-schedule.png', async () => {
    await store(`s.homeTab = 'schedule'; s.view = 'home'`)
    await wait(1500)
    await save('home-schedule.png')
    await store(`s.homeTab = 'recent'`)
})

shot('palette.png', async () => {
    await store(`s.view = 'home'; s.paletteOpen = true`)
    await wait(500)
    await win.keyboard.type('leave')
    await wait(800)
    await save('palette.png')
})

shot('setup-repos.png', async () => {
    await store(`s.view = 'home'; s.openSettings('setup', 'repos')`)
    await seen('Add a repository')
    await wait(800)
    await save('setup-repos.png', { clip: { x: 0, y: 0, width: 1920, height: 760 } })
})

async function repoRowButton(repo: string, label: string) {
    await store(`s.view = 'home'; s.openSettings('setup', 'repos')`)
    await seen('Add a repository')
    const row = win
        .locator('div', { has: win.getByText(repo, { exact: false }) })
        .filter({ has: win.getByRole('button', { name: label }) })
        .last()
    await row.getByRole('button', { name: label }).first().click()
    await wait(800)
}

shot('repo-duplicate.png', async () => {
    await repoHome(dirs.rules)
    await repoRowButton('Acme_Internal_Rules', 'Duplicate')
    await seen('Duplicate repository')
    await save('repo-duplicate.png')
})

shot('repo-fork.png', async () => {
    await repoHome(dirs.rules)
    await repoRowButton('Acme_Contracts', 'Fork')
    await save('repo-fork.png')
})

shot('repo-switcher.png', async () => {
    await store(`s.homeTab = 'recent'; s.view = 'home'`)
    await wait(600)
    await win.locator('header button', { hasText: 'Acme_Internal_Rules' }).first().click()
    await wait(500)
    await win.getByText('Move to group').filter({ visible: true }).first().hover()
    await wait(700)
    await save('repo-switcher.png', { clip: { x: 0, y: 0, width: 1240, height: 600 } })
})

shot('repo-sections.png', async () => {
    await store(`s.homeTab = 'recent'; s.view = 'home'`)
    await win.getByRole('button', { name: 'Open sidebar' }).first().click()
    await wait(600)
    await win.locator('.repos .repo', { hasText: 'Acme_Internal_Rules' }).first().click({ button: 'right' })
    await wait(400)
    const item = win.getByText('Move to group').filter({ visible: true }).first()
    await item.hover()
    await wait(300)
    const ib = (await item.boundingBox())!
    await win.mouse.move(ib.x + 10, ib.y + ib.height / 2, { steps: 4 })
    await win.mouse.move(ib.x + 40, ib.y + ib.height / 2, { steps: 4 })
    await wait(800)
    if (process.env.DEBUG_SHOTS) console.log('submenu', await win.getByText('New group…').count(), await win.locator('[role=menu]').count())
    await save('repo-sections.png', { clip: { x: 0, y: 0, width: 1000, height: 560 } })
    await win.keyboard.press('Escape')
    await win.keyboard.press('Escape')
    await win
        .getByRole('button', { name: /Close sidebar|Collapse sidebar/ })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {})
})

shot('repo-home.png', async () => {
    await repoHome(dirs.contracts)
    const toggle = win.getByRole('switch', { name: 'Include documents in subfolders' })
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
    await wait(1500)
    await save('repo-home.png')
})

shot('new-doc.png', async () => {
    await repoHome(dirs.rules)
    await store(`s.dialog = { kind: 'newDoc' }`)
    await wait(800)
    await save('new-doc.png')
})

shot('editor.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await save('editor.png')
})

// 編集の欄（CodeMirror）を直接動かす
const cm = (code: string) =>
    win.evaluate(`(() => { const el = document.querySelector('.cm-content'); const v = (el.cmTile ?? el.cmView).root?.view ?? el.cmView?.view; ${code} })()`)
async function cursorAt(text: string, { offset = 0, end = false, top = false } = {}) {
    await cm(`
        const doc = v.state.doc.toString()
        const i = doc.indexOf(${JSON.stringify(text)})
        if (i < 0) throw new Error('not found: ' + ${JSON.stringify(text)})
        const pos = i + (${end} ? ${JSON.stringify(text)}.length : ${offset})
        v.focus()
        v.dispatch({ selection: { anchor: pos }, effects: ${top} ? v.constructor.scrollIntoView(pos, { y: 'start', yMargin: 24 }) : v.constructor.scrollIntoView(pos, { y: 'center' }) })
    `)
    await wait(400)
}
async function selectText(text: string) {
    await cm(`
        const i = v.state.doc.toString().indexOf(${JSON.stringify(text)})
        v.focus()
        v.dispatch({ selection: { anchor: i, head: i + ${JSON.stringify(text)}.length }, scrollIntoView: true })
    `)
    await wait(300)
}
async function discard() {
    await store(`if (s.currentDoc?.changed) await window.api.discardChanges(s.repoDir, s.currentPath); s.reloadKey++`)
    await wait(800)
    await store(`await s.refreshDocs()`)
    await wait(500)
}
const lineOf = (text: string) => win.locator('.cm-line', { hasText: text }).first()

shot(['editor-ref.png', 'editor-edited.png', 'save-version.png'], async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('governed by applicable employment laws and regulations.', { end: true })
    await win.keyboard.press('Enter')
    await win.keyboard.type('Notwithstanding the preceding paragraph, officers among the persons covered by clause [[sco', { delay: 30 })
    await wait(1200)
    await save('editor-ref.png')
    await win.locator('.cm-tooltip-autocomplete li').first().click()
    await wait(300)
    await win.keyboard.press('End')
    await win.keyboard.type(' are subject to separate rules.', { delay: 10 })
    await wait(2500)
    await save('editor-edited.png')
    await win.getByRole('button', { name: 'Save version' }).first().click()
    await wait(600)
    await win.keyboard.type('1.1: add a paragraph on officers')
    await wait(500)
    await save('save-version.png')
    await win.keyboard.press('Escape')
    await discard()
})

shot('editor-backref.png', async () => {
    await openDoc(dirs.contracts, MSA)
    await cursorAt('The fee for the Services', { offset: 4 })
    await lineOf('The fee for the Services').click({ button: 'right', position: { x: 120, y: 10 } })
    await wait(400)
    await win
        .getByText(/Referenced by \(/)
        .filter({ visible: true })
        .first()
        .hover()
    await wait(600)
    await save('editor-backref.png', { clip: { x: 28, y: 145, width: 1100, height: 800 } })
})

shot('editor-trail.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('Employees undergoing fertility treatment', { top: true })
    await wait(600)
    await win.locator('.trail-btn').first().click()
    await wait(1500)
    await save('editor-trail.png', { clip: { x: 0, y: 600, width: 1100, height: 600 } })
})

shot('editor-issues.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('may take up to 5 days of leave per year upon request.', { end: true })
    await win.keyboard.type(' The Company shall approve the leave prior to the start date and/or as set out in [[Leave Procedure]].', { delay: 5 })
    await wait(2500)
    await cursorAt('Employees undergoing fertility treatment', { top: true })
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M')
    await wait(1200)
    await save('editor-issues.png', { clip: { x: 0, y: 634, width: 1100, height: 566 } })
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M')
    await discard()
})

async function hoverText(text: string, offset = 1) {
    const box = (await cm(`
        const i = v.state.doc.toString().indexOf(${JSON.stringify(text)})
        const r = v.coordsAtPos(i + ${offset})
        return r && { x: r.left, y: (r.top + r.bottom) / 2 }
    `)) as { x: number; y: number }
    await win.mouse.move(box.x - 20, box.y + 30)
    await win.mouse.move(box.x + 2, box.y, { steps: 8 })
    await wait(1500)
    for (let i = 0; i < 3 && !(await win.locator('.cm-tooltip').count()); i++) {
        await win.mouse.move(box.x + 6, box.y + 1, { steps: 4 })
        await wait(1200)
    }
    if (process.env.DEBUG_SHOTS)
        console.log(
            'hover',
            box,
            await win.evaluate(`[document.querySelectorAll('.cm-tooltip').length, document.elementFromPoint(${box.x + 2}, ${box.y})?.outerHTML.slice(0, 200)]`),
        )
}

// 一時的な見本の文書。撮ったら消す（版には入れない）
const EN_STYLE = '<!-- clausedown\ndoc: { style: contract }\n-->\n'
const temps: string[] = []
async function tempDoc(dir: string, path: string, text: string) {
    fs.writeFileSync(join(dir, path), text, 'utf8')
    temps.push(join(dir, path))
    await store(`await s.refreshDocs()`)
    await wait(500)
    await openDoc(dir, path)
    return async () => {
        await store(`s.view = 'docs'`)
        fs.rmSync(join(dir, path), { force: true })
        await store(`await s.refreshDocs()`)
    }
}

const EDITOR_TOP = { x: 262, y: 185, width: 590, height: 210 }

shot('editor-definitions.png', async () => {
    const done = await tempDoc(
        dirs.contracts,
        'consulting-agreement.md',
        '# Consulting Agreement\n\n### Engagement\n- The Client engages the Consultant to provide advisory services.\n- Acme Corp. (the "Client") engages Riverside Consulting LLC (the "Consultant") under this Agreement.\n- The consulting fee (the "Fee") will be agreed separately.\n',
    )
    await wait(1500)
    await hoverText('The Client engages', 5)
    await save('editor-definitions.png', { clip: EDITOR_TOP, hi: true })
    await done()
})

shot('editor-proofread.png', async () => {
    const done = await tempDoc(
        dirs.contracts,
        'consulting-agreement.md',
        '# Consulting Agreement\n\n### Engagement\n- Acme Corp. and Riverside Consulting LLC agree as follows.\n- Prior to the start date, the Consultant shall deliver the work plan and/or the schedule described herein.\n- The consulting fee (the "Fee") will be agreed separately.\n',
    )
    await wait(1500)
    await hoverText('Prior to the start', 2)
    await save('editor-proofread.png', { clip: EDITOR_TOP, hi: true })
    await done()
})

shot('editor-config.png', async () => {
    await openDoc(dirs.contracts, NDA)
    await win.getByRole('button', { name: 'Formatting' }).first().click()
    await wait(1200)
    await save('editor-config.png')
    await win.getByRole('button', { name: 'Formatting' }).first().click()
})

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

shot('editor-search.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('This Handbook applies to all employees', { offset: 30 })
    await win.keyboard.press(`${MOD}+F`)
    await wait(300)
    await win.keyboard.type('employee')
    await wait(1500)
    await save('editor-search.png')
    await win.keyboard.press('Escape')
})

shot(['editor-context.png', 'format-modal.png'], async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await selectText('working conditions and rules of conduct')
    const box = (await cm(`
        const i = v.state.doc.toString().indexOf('working conditions and rules of conduct')
        const r = v.coordsAtPos(i + 10)
        return { x: r.left, y: (r.top + r.bottom) / 2 }
    `)) as { x: number; y: number }
    await win.mouse.click(box.x, box.y, { button: 'right' })
    await wait(800)
    await save('editor-context.png')
    await win.getByText('Format selection…').filter({ visible: true }).first().click()
    await wait(1000)
    await save('format-modal.png')
    await win.keyboard.press('Escape')
})

shot('prop.png', async () => {
    const done = await tempDoc(
        dirs.contracts,
        'fee-schedule.md',
        `# Fee Schedule\n${EN_STYLE}\n### Fees\n- The fees are as set out in the following table.\n  ::: {size=8.5pt cols=25,75}\n  | Item | Details |\n  |---|---|\n  | Base fee | $3,000 per month (excluding tax) |\n  :::\n`,
    )
    await wait(2500)
    const art = (await win.locator('.cd-para', { hasText: 'following table' }).first().boundingBox())!
    const table = (await win.locator('.cd-article table').first().boundingBox())!
    await save('prop.png', {
        clip: { x: art.x - 6, y: art.y - 6, width: Math.max(art.width, table.x + table.width - art.x) + 12, height: table.y + table.height - art.y + 12 },
    })
    await done()
})

shot('table1.png', async () => {
    const done = await tempDoc(
        dirs.contracts,
        'pay-table.md',
        `# Pay Table\n${EN_STYLE}\n### Pay\n- Pay is as follows.\n  | Category | > | Details |\n  |---|---|---|\n  | Full-time | Monthly | No fixed term |\n  | ^ | Hourly | During probation |\n`,
    )
    await wait(2500)
    const table = win.locator('.cd-paper table, .preview table').first()
    const b = (await table.boundingBox())!
    await save('table1.png', { clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } })
    await done()
})

async function hideOutline() {
    await win.locator('.cd-toolbar button').first().click()
    await wait(600)
}
const editorBox = async () => (await win.locator('.cm-editor').first().boundingBox())!

shot('editor-math.png', async () => {
    await viewport(1220, 800)
    await openDoc(dirs.city, ENERGY)
    await hideOutline()
    await wait(2500)
    const e = await editorBox()
    await save('editor-math.png', { clip: { x: e.x, y: e.y, width: 1182, height: 590 }, hi: true })
    await hideOutline()
})

shot('editor-insert.png', async () => {
    await openDoc(dirs.city, ENERGY)
    await cursorAt('Any fraction of less than', { offset: 3 })
    await win.getByRole('button', { name: 'Insert' }).first().click()
    await wait(500)
    await win.getByRole('menuitem', { name: 'Math' }).first().hover()
    await wait(800)
    const menu = (await win.locator('[role="menu"]').first().boundingBox())!
    await save('editor-insert.png', { clip: { x: menu.x - 4, y: menu.y - 4, width: 470, height: Math.max(490, menu.height + 8) }, hi: true })
})

shot('editor-guides.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('Proof of address')
    await wait(800)
    const box = (await win.locator('.cm-editor').first().boundingBox())!
    const line = (await win.locator('.cm-line', { hasText: 'Hiring and Transfers' }).first().boundingBox())!
    await save('editor-guides.png', { clip: { x: box.x, y: line.y - 8, width: Math.min(box.width, 760), height: 330 }, hi: true })
})

shot('editor-export.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await win.getByRole('button', { name: 'Export' }).first().click()
    await wait(800)
    await save('editor-export.png', { clip: { x: 560, y: 0, width: 1360, height: 560 } })
})

shot('export-toast.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    const file = join(tmp, 'Employee Handbook.html')
    fs.writeFileSync(file, '<!doctype html>', 'utf8')
    await app.evaluate(({ ipcMain }, p) => {
        ipcMain.removeHandler('exportFile')
        ipcMain.handle('exportFile', async () => p)
    }, file)
    await win.getByRole('button', { name: 'Export' }).first().click()
    await wait(500)
    await win.getByRole('menuitem', { name: 'Export as HTML' }).first().click()
    const toast = win
        .locator('[data-slot="root"]', { hasText: 'Exported' })
        .or(win.locator('li', { hasText: 'Exported' }))
        .first()
    await toast.waitFor()
    await wait(800)
    const b = (await toast.boundingBox())!
    await save('export-toast.png', { clip: { x: Math.round(b.x + b.width / 2 - 412), y: 1200 - 350, width: 824, height: 350 } })
})

shot('render_example.png', async () => {
    await viewport(1000, 700)
    const done = await tempDoc(
        dirs.contracts,
        'work-rules-sample.md',
        `# Work Rules\n${EN_STYLE}## General Provisions\n### Purpose {#purpose}\n- These rules …\n- Notwithstanding the preceding paragraph, …\n  - full-time employees\n  - fixed-term employees\n- Under [[purpose]], …\n`,
    )
    await hideOutline()
    await cursorAt('Under [[purpose]]', { offset: 3 })
    await wait(2000)
    const e = await editorBox()
    await save('render_example.png', { clip: { x: e.x, y: e.y - 32, width: 912, height: 440 } })
    await hideOutline()
    await done()
})

const button = (name: string | RegExp) => win.getByRole('button', { name }).filter({ visible: true }).first()

shot(['history.png', 'effective-modal.png'], async () => {
    await openDoc(dirs.rules, HANDBOOK, 'history')
    await seen('Change bereavement leave for the death of a sibling')
    await wait(1500)
    await save('history.png')
    await button('Set effective date').click()
    await wait(800)
    await save('effective-modal.png')
})

shot('compare.png', async () => {
    await openDoc(dirs.rules, HANDBOOK, 'compare')
    await wait(2500)
    await tableFormat()
    await save('compare.png')
    await diffFormat()
})

shot(['branch-menu.png', 'new-branch.png'], async () => {
    await repoHome(dirs.rules)
    await win.getByRole('button', { name: 'Switch working draft' }).first().click()
    await wait(800)
    await save('branch-menu.png')
    await win.keyboard.press('Escape')
    await store(`s.dialog = { kind: 'newBranch' }`)
    await wait(800)
    await save('new-branch.png')
})

shot(['releases.png', 'deliver-modal.png'], async () => {
    await openDoc(dirs.rules, HANDBOOK, 'releases')
    await wait(1500)
    await win.getByText('Raise fertility treatment leave and the commuting allowance cap').filter({ visible: true }).first().click()
    await wait(2000)
    await save('releases.png')
    await button('Deliver').click()
    await wait(800)
    await save('deliver-modal.png')
})

shot(['schedule.png', 'schedule-select.png', 'schedule-list.png', 'due-modal.png'], async () => {
    await repoHome(dirs.rules)
    await store(`await s.openSchedule()`)
    await wait(2000)
    await save('schedule.png')
    await win.locator('svg text, .tl-label, button, span', { hasText: 'Submit the draft to the board' }).filter({ visible: true }).first().click()
    await wait(1000)
    await save('schedule-select.png')
    await win
        .getByRole('radio', { name: 'List' })
        .or(win.getByRole('button', { name: 'List' }))
        .first()
        .click()
    await wait(1200)
    await save('schedule-list.png')
    await win
        .getByRole('radio', { name: 'Timeline' })
        .or(win.getByRole('button', { name: 'Timeline' }))
        .first()
        .click()
    await wait(800)
    await button('Add due date').click()
    await wait(800)
    await win
        .getByRole('radio', { name: 'Promulgation' })
        .or(win.getByRole('button', { name: 'Promulgation' }))
        .first()
        .click()
        .catch(() => {})
    await wait(500)
    await save('due-modal.png')
})

shot('repo-kinds.png', async () => {
    await repoHome(dirs.rules)
    await store(`await s.openSchedule(); s.openSettings('repo', 'kinds')`)
    await wait(1200)
    await save('repo-kinds.png')
})

shot('repo-style.png', async () => {
    await repoHome(dirs.rules)
    await store(`s.openSettings('repo', 'style')`)
    await wait(2000)
    await save('repo-style.png')
})

shot('repo-rules.png', async () => {
    await repoHome(dirs.rules)
    await store(`s.openSettings('repo', 'rules')`)
    await wait(1200)
    await save('repo-rules.png')
})

for (const [name, tab] of [
    ['setup-due.png', 'due'],
    ['setup-remote.png', 'remote'],
    ['setup-ai.png', 'ai'],
    ['setup-profile.png', 'profile'],
] as const) {
    shot(name, async () => {
        await repoHome(dirs.rules)
        await store(`s.openSettings('setup', '${tab}')`)
        await wait(1500)
        await save(name)
    })
}

shot('setup-developer.png', async () => {
    await repoHome(dirs.rules)
    await store(`s.openSettings('setup', 'developer')`)
    await wait(1500)
    await save('setup-developer.png', { clip: { x: 0, y: 0, width: 1920, height: 1010 } })
})

shot('remote-login.png', async () => {
    await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('loginStart')
        ipcMain.handle('loginStart', async () => ({ userCode: 'DE22-3818', verificationUri: 'https://github.com/login/device', expiresIn: 900 }))
        ipcMain.removeHandler('loginWait')
        // 待ち続ける（約束が回収されると「reply was never sent」が出るので、タイマーで握っておく）
        ipcMain.handle('loginWait', () => new Promise((r) => setTimeout(r, 3_600_000)))
    })
    await store(`s.view = 'home'; s.openSettings('setup', 'remote')`)
    await wait(1000)
    await win.getByRole('button', { name: 'Sign in' }).first().click()
    await wait(1200)
    await save('remote-login.png')
})

shot(['sync-menu.png', 'sync-add-remote.png'], async () => {
    await repoHome(dirs.rules)
    await win.getByRole('button', { name: 'Remote menu' }).first().click()
    await wait(800)
    await save('sync-menu.png')
    await win.getByText('Add remote…').filter({ visible: true }).first().click()
    await wait(800)
    const select = win.getByRole('combobox').filter({ visible: true }).first()
    await select.click()
    await wait(300)
    await win
        .getByRole('option', { name: 'GitHub' })
        .first()
        .click()
        .catch(() => {})
    await wait(500)
    await win
        .getByPlaceholder(/github\.com/)
        .first()
        .fill('https://github.com/example-office/rules.git')
    await wait(500)
    await save('sync-add-remote.png')
})

// ---------- 1440×900 の紹介用 ----------

shot('feature-editor.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('### Bereavement Leave', { offset: 4, top: true })
    await wait(1200)
    await save('feature-editor.png')
})

async function openAi() {
    await win.getByRole('button', { name: 'AI', exact: true }).first().click()
    await wait(1500)
}

shot('feature-ai.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('### Bereavement Leave', { offset: 4, top: true })
    await openAi()
    await save('feature-ai.png')
    await openAi()
})

shot('feature-history.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK, 'history')
    await win.getByText("Add bereavement leave for a child's school entry").filter({ visible: true }).first().click()
    await wait(1500)
    await save('feature-history.png')
})

async function tableFormat() {
    await win
        .getByRole('radio', { name: 'Comparison table' })
        .or(win.getByRole('button', { name: 'Comparison table', exact: true }))
        .last()
        .click()
    await wait(1500)
}
async function diffFormat() {
    await win
        .getByRole('radio', { name: 'Diff' })
        .or(win.getByRole('button', { name: 'Diff', exact: true }))
        .first()
        .click()
    await wait(500)
}

shot('feature-compare.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK, 'compare')
    await wait(1500)
    await tableFormat()
    await win
        .locator('section, div')
        .filter({ hasText: /^After/ })
        .getByText('Raise fertility treatment leave')
        .first()
        .click()
        .catch(() => {})
    await wait(1500)
    await save('feature-compare.png')
    await diffFormat()
})

shot('feature-releases.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK, 'releases')
    await win.getByText('Raise fertility treatment leave and the commuting allowance cap').filter({ visible: true }).first().click()
    await wait(2000)
    await save('feature-releases.png')
})

shot('feature-schedule.png', async () => {
    await viewport(1440, 900)
    await store(`s.homeTab = 'schedule'; s.view = 'home'`)
    await wait(1800)
    await save('feature-schedule.png')
    await store(`s.homeTab = 'recent'`)
})

shot('feature-review.png', async () => {
    await viewport(1440, 900)
    await repoHome(dirs.rules)
    await store(`s.dialog = { kind: 'review', branch: ${JSON.stringify(git.draftRef('April-2027-revision'))} }`)
    await wait(2000)
    await save('feature-review.png')
})

shot('feature-issues.png', async () => {
    await viewport(1440, 900)
    await openDoc(dirs.rules, HANDBOOK)
    await store(`s.openIssues({ n: 3 })`)
    await wait(2000)
    await save('feature-issues.png')
})

shot('feature-sync.png', async () => {
    await viewport(1440, 900)
    await repoHome(dirs.rules)
    await win.getByRole('button', { name: 'Remote menu' }).first().click()
    await wait(500)
    await win.getByText('Add remote…').filter({ visible: true }).first().click()
    await wait(1000)
    await save('feature-sync.png')
})

// ---------- AI のパネル ----------

shot('editor-ai.png', async () => {
    await viewport(1934, 1068)
    await openDoc(dirs.rules, HANDBOOK)
    await openAi()
    await win.locator('textarea').filter({ visible: true }).last().fill('Make the wording of 5.6 more concise')
    await wait(500)
    // 日本語版と同じく、AI のボタンとパネルを赤で囲む
    const btn = (await win.getByRole('button', { name: 'AI', exact: true }).first().boundingBox())!
    const panel = (await win.locator('aside.ai-panel').first().boundingBox())!
    await win.evaluate(
        ([b, p]) => {
            const mark = (css: string, html = '') => {
                const d = document.createElement('div')
                d.className = 'shot-mark'
                d.style.cssText = `position:fixed;z-index:99999;pointer-events:none;${css}`
                d.innerHTML = html
                document.body.appendChild(d)
            }
            mark(`left:${p.x - 3}px;top:${p.y - 3}px;width:${p.width + 6}px;height:${p.height + 6}px;border:3px solid #e01e1e;box-sizing:border-box`)
            const x = b.x + b.width / 2
            mark(
                `left:${x - 12}px;top:${b.y - 46}px;width:24px;height:42px`,
                '<svg width="24" height="42" viewBox="0 0 24 42"><path d="M12 0v30" stroke="#e01e1e" stroke-width="4"/><path d="M2 26l10 14 10-14z" fill="#e01e1e"/></svg>',
            )
        },
        [btn, panel] as const,
    )
    await save('editor-ai.png')
    await win.evaluate(() => document.querySelectorAll('.shot-mark').forEach((e) => e.remove()))
    await openAi()
})

// ---------- 改定案 ----------

const DRAFT = git.draftRef('April-2027-revision')

shot(['draft-repo-home.png', 'draft-editor.png', 'review-modal.png', 'dark-editor.png', 'merge-modal.png'], async () => {
    await repoHome(dirs.rules)
    await store(`await s.switchBranch(${JSON.stringify(DRAFT)}); s.view = 'docs'`)
    await wait(2000)
    if (want('draft-repo-home.png')) await save('draft-repo-home.png')
    await openDoc(dirs.rules, HANDBOOK)
    await cursorAt('### Bereavement Leave', { offset: 4, top: true })
    await wait(1500)
    if (want('draft-editor.png')) await save('draft-editor.png')
    await store(`s.dialog = { kind: 'review', branch: ${JSON.stringify(DRAFT)} }`)
    await wait(2000)
    if (want('review-modal.png')) await save('review-modal.png')
    await store(`s.dialog = null`)
    await wait(500)
    if (want('dark-editor.png')) {
        await cursorAt('# Employee Handbook', { top: true })
        await win.getByRole('button', { name: 'Switch to dark mode' }).first().click()
        await wait(1500)
        await save('dark-editor.png')
        await win.getByRole('button', { name: 'Switch to light mode' }).first().click()
        await wait(800)
    }
    await button(/Merge into current/).click()
    await wait(2500)
    if (want('merge-modal.png')) await save('merge-modal.png')
    await win.keyboard.press('Escape')
    await wait(500)
    await store(`s.dialog = null; await s.switchBranch('main')`)
    await wait(1000)
})

// ---------- houritsu ----------

shot(['houritsu-ask.png', 'houritsu-done.png', 'houritsu-doc.png'], async () => {
    await repoHome(dirs.houritsu)
    await store(`const paths = await window.api.detectHouritsu(s.repoDir); s.dialog = { kind: 'houritsu', dir: s.repoDir, paths }`)
    await wait(1500)
    await save('houritsu-ask.png')
    await button('Convert and save version').click()
    await seen(/Converted/, 60000)
    await wait(1500)
    await save('houritsu-done.png')
    await win.keyboard.press('Escape')
    await store(`s.dialog = null`)
    await openDoc(dirs.houritsu, 'laws/act/412/412AC0000000061.md')
    await wait(1500)
    await save('houritsu-doc.png')
})

// ---------- 課題（1280×800、小さなリポジトリ） ----------

shot(['issue-comments.png', 'issue-hash.png', 'save-version-issues.png', 'issue-link.png', 'issues.png'], async () => {
    await viewport(1280, 800)
    await app.evaluate(({ dialog }, d) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] })
    }, dirs.beta)
    await store(`
        await window.api.pickFolder()
        if (!s.settings.repos.some((r) => r.dir === ${JSON.stringify(dirs.beta)})) await s.saveSettings({ ...s.settings, repos: [...s.settings.repos, { name: 'Beta_Co', dir: ${JSON.stringify(dirs.beta)}, section: 'Beta Co.' }] })
        await s.checkRepos()
        await s.switchRepo(${JSON.stringify(dirs.beta)})
    `)
    await wait(1500)
    await store(`s.openIssues({ n: 1 })`)
    await wait(2000)
    await save('issue-comments.png')
    await openDoc(dirs.beta, 'work-rules.md')
    await cursorAt('Days off are Sundays.', { offset: 12 })
    await win.keyboard.type('Saturdays and ')
    await wait(1500)
    await button('Save version').click()
    await wait(800)
    await win.keyboard.type('Add Saturdays to days off #')
    await wait(800)
    await save('issue-hash.png')
    await win.locator('.hint', { hasText: 'Make Saturdays a day off' }).first().dispatchEvent('mousedown')
    await wait(500)
    await win.getByRole('dialog').getByText('Choose an issue…').first().click()
    await wait(500)
    await win.getByRole('option', { name: /#1/ }).first().click()
    await wait(800)
    await save('save-version-issues.png')
    await win.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await wait(2500)
    await store(`s.view = 'history'`)
    await wait(2000)
    await button('Link to issue').click()
    await wait(1200)
    await save('issue-link.png')
    await win.keyboard.press('Escape')
    await store(`s.openIssues({ n: 1 })`)
    await wait(2000)
    await save('issues.png')
})

shot('editor-print.png', async () => {
    await openDoc(dirs.rules, HANDBOOK)
    await win
        .getByRole('button', { name: 'Print' })
        .or(win.getByRole('radio', { name: 'Print' }))
        .first()
        .click()
    await wait(4000)
    await save('editor-print.png')
    await win
        .getByRole('button', { name: 'Normal' })
        .or(win.getByRole('radio', { name: 'Normal' }))
        .first()
        .click()
})

const COVER_DOC = 'handbook-with-cover.md'
const COVER_SRC = [
    '# Employee Handbook',
    '',
    '::: cover',
    '{right}',
    'Confidential',
    '',
    '{center size=26pt}',
    'Employee Handbook',
    '',
    '::: {center}',
    'Policy No. 12',
    '',
    'Effective April 1, 2026',
    '',
    'Acme Corp. Human Resources',
    ':::',
    ':::',
    '',
    '[[_TOC_]]',
    '',
    '## General Provisions',
    '',
    '### Purpose',
    '- This Handbook sets out the terms and conditions of employment and the rules of conduct that apply to all employees of Acme Corp.',
    '',
    '### Definitions',
    '- In this Handbook, "employee" means any person employed by Acme Corp. under a contract of employment, whether full-time or part-time.',
    '',
    '## Working Hours',
    '',
    '### Working Hours',
    '- Normal working hours are 9:00 a.m. to 6:00 p.m., Monday to Friday, with a one-hour lunch break.',
    '',
    '### Overtime',
    '- Employees may be asked to work overtime when business needs require it, within the limits set by law and the applicable labor agreement.',
    '',
].join('\n')

shot('cover-toc.png', async () => {
    fs.writeFileSync(join(dirs.rules, COVER_DOC), COVER_SRC, 'utf8')
    await openDoc(dirs.rules, COVER_DOC)
    await win
        .getByRole('button', { name: 'Print' })
        .or(win.getByRole('radio', { name: 'Print' }))
        .first()
        .click()
    await store(`s.prefs.zoomLinked = false; s.prefs.previewZoom = 45`)
    await wait(5000)
    await save('cover-toc.png')
    await store(`s.prefs.previewZoom = 100; s.prefs.zoomLinked = true`)
    await win
        .getByRole('button', { name: 'Normal' })
        .or(win.getByRole('radio', { name: 'Normal' }))
        .first()
        .click()
    fs.rmSync(join(dirs.rules, COVER_DOC), { force: true })
})

let signingReady = false
async function signingSetup() {
    if (signingReady) return
    await win.evaluate(`(async () => {
        await window.api.generateSigningKey()
        await window.api.createSelfSignedCert({ name: ${JSON.stringify(ME.name)}, email: ${JSON.stringify(ME.email)}, years: 3, label: 'Personal' })
        const corp = await window.api.createSelfSignedCert({ name: ${JSON.stringify(ME.name)}, org: 'Acme Corp.', years: 2, label: 'Acme Corp. (CEO)' })
        await window.api.updatePdfCert(corp.id, { reason: 'Execution of the agreement' })
        await window.api.setSigningPrefs({ pdf: { reason: 'Approval', location: 'New York', tsa: { enabled: true } } })
    })()`)
    signingReady = true
}

shot('signature-storage.png', async () => {
    await win.evaluate(`window.api.deleteSigningKey()`)
    await repoHome(dirs.rules)
    await store(`s.openSettings('setup', 'signature')`)
    await win.getByRole('tab', { name: 'Versions and approvals' }).first().click()
    await win.getByText('Key storage').first().waitFor()
    await wait(1200)
    const rows = win.locator('.row').filter({ has: win.getByText(/^(Key storage|Signing key)$/) })
    const boxes = (await Promise.all((await rows.all()).map((r) => r.boundingBox()))).filter((b) => !!b)
    const top = Math.min(...boxes.map((b) => b.y))
    const left = Math.min(...boxes.map((b) => b.x))
    const right = Math.max(...boxes.map((b) => b.x + b.width))
    const bottom = Math.max(...boxes.map((b) => b.y + b.height))
    await save('signature-storage.png', { clip: { x: left - 8, y: top - 8, width: right - left + 16, height: bottom - top + 16 }, hi: true })
    if (signingReady) await win.evaluate(`window.api.generateSigningKey()`)
})

shot(['setup-signature.png', 'setup-signature-pdf.png'], async () => {
    await signingSetup()
    await repoHome(dirs.rules)
    await store(`s.openSettings('setup', 'signature')`)
    await win.getByRole('tab', { name: 'Versions and approvals' }).first().click()
    await wait(1500)
    await save('setup-signature.png')
    await win.getByRole('tab', { name: 'PDF', exact: true }).first().click()
    await wait(800)
    await save('setup-signature-pdf.png')
})

async function setExperiment(id: string, on: boolean) {
    await store(`await s.saveSettings({ ...s.settings, experiments: { ...s.settings.experiments, ${JSON.stringify(id)}: ${on} } })`)
    await wait(300)
}

shot(['setup-signature-md.png', 'editor-signatures.png'], async () => {
    await signingSetup()
    await setExperiment('cdsign', true)
    const key = (await win.evaluate(`window.api.addMdKey({ kind: 'app', label: 'Acme Corp.', method: 'dns', signer: 'acme.example', selector: '2026' })`)) as {
        id: string
    }
    await repoHome(dirs.rules)
    await store(`s.openSettings('setup', 'signature')`)
    await win.getByRole('tab', { name: 'Markdown (experimental)', exact: true }).first().click()
    await wait(1200)
    await save('setup-signature-md.png')

    const us = await generateEd25519()
    const text =
        '# Services Agreement\n' +
        EN_STYLE +
        '\n### Services\n- The Provider shall provide the services described in Schedule 1.\n\n### Fees\n- The Client shall pay the fees within 30 days of the invoice date.\n\n## Signatures {.closing}\n\nAcme Corp.\n\nNorthwind Traders Ltd.\n'
    const a = await signDocument(text, {
        signer: us.signer,
        method: 'tofu',
        signerId: 'legal@acme.example',
        role: 'author',
        require: [{ method: 'tofu', signer: 'legal@northwind.example', role: 'approver' }],
        extra: { x_clausedown: 'a'.repeat(40) },
    })
    const passkey = await createSoftwareAuthenticator('sign.clausedown.app')
    const b = await signDocument(a.text, { signer: passkey, method: 'tofu', signerId: 'legal@northwind.example', role: 'approver' })
    for (const block of [a, b]) await win.evaluate(([signer, pubkey]) => window.api.trustMdKey(signer, pubkey), [block.fields.signer, block.fields.pubkey])
    const done = await tempDoc(dirs.contracts, 'services-agreement-signed.md', b.text)
    await wait(1500)
    await win
        .getByRole('button', { name: /^Signature verification/ })
        .first()
        .click()
    await wait(1500)
    await save('editor-signatures.png')
    await win
        .getByRole('button', { name: /^Signature verification/ })
        .first()
        .click()
    await done()
    await win.evaluate((id) => window.api.removeMdKey(id), key.id)
    await setExperiment('cdsign', false)
})

shot('pdf-sign-dialog.png', async () => {
    await signingSetup()
    await openDoc(dirs.contracts, MSA)
    await win.getByRole('button', { name: 'Export' }).first().click()
    await wait(600)
    await win.getByRole('menuitem', { name: 'Export as PDF' }).first().click()
    await wait(1200)
    await save('pdf-sign-dialog.png')
    await win.keyboard.press('Escape')
})

shot('repo-policy.png', async () => {
    await signingSetup()
    await repoHome(dirs.rules)
    await win.evaluate(
        `window.api.policyStatus(${JSON.stringify(dirs.rules)}).then((p) => p.version ? p : window.api.signLegacyRules(${JSON.stringify(dirs.rules)}))`,
    )
    await store(`s.openSettings('repo', 'rules')`)
    await wait(1500)
    await save('repo-policy.png')
})

shot(['seal-modal.png', 'feature-signing.png'], async () => {
    await viewport(1440, 900)
    await openDoc(dirs.contracts, MSA)
    await cursorAt('By: ____________', { end: true })
    await win.getByRole('button', { name: 'Insert' }).first().click()
    await wait(500)
    await win.getByRole('menuitem', { name: 'Seal or signature' }).first().click()
    await wait(800)
    await win
        .getByRole('radio', { name: 'Latin (stamp)' })
        .or(win.getByRole('button', { name: 'Latin (stamp)' }))
        .first()
        .click()
    await win.getByLabel('Name').first().fill(ME.name)
    await win.getByLabel('Bottom text (optional)').first().fill('ACME CORP.')
    await wait(800)
    await save('seal-modal.png')
    await win.getByRole('button', { name: 'Insert', exact: true }).last().click()
    await wait(2000)
    await cursorAt('By: ____________', { end: true })
    await win
        .locator('.preview .cd-seal, .preview img')
        .last()
        .evaluate((el) => el.scrollIntoView({ block: 'center' }))
        .catch(() => {})
    await wait(1200)
    await save('feature-signing.png')
    await discard()
})

shot('received-modal.png', async () => {
    await app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('pickReceivedPdf')
        ipcMain.handle('pickReceivedPdf', async () => ({
            path: '/tmp/Employee Handbook (signed by HR).pdf',
            name: 'Employee Handbook (signed by HR).pdf',
            signatures: [
                { signer: 'Alex Morgan', signedAt: '2026-04-01T01:00:00.000Z' },
                { signer: 'Jordan Lee', signedAt: '2026-04-02T06:30:00.000Z' },
            ],
        }))
    })
    await openDoc(dirs.rules, HANDBOOK, 'releases')
    await wait(1500)
    await win.getByText('Acme Corp. HR Department').filter({ visible: true }).first().click()
    await wait(1200)
    await win.getByRole('button', { name: 'Save the signed PDF you received' }).first().click()
    await wait(1200)
    await save('received-modal.png')
})

// ---------- 実行 ----------

const want = (name: string) => !ONLY.length || ONLY.includes(name)
const PREFS = { language: 'en', syncOnStart: false, pushOnSave: false, notifyDue: false, reopenLastDoc: false, checkUpdateOnStart: false }

async function launch(name: string, settings: Record<string, unknown>) {
    const userData = join(tmp, `user-data-${name}`)
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(join(userData, 'settings.json'), JSON.stringify(settings), 'utf8')
    // VS Code のターミナルなどで ELECTRON_RUN_AS_NODE が付いていると、Electron が Node として動いてアプリが起動しない
    const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>
    // 細かい部分の写真は 2 倍で撮るので、画面の倍率を 2 に固定する
    app = await _electron.launch({
        executablePath: electronPath as unknown as string,
        args: ['.', `--user-data-dir=${userData}`, '--force-device-scale-factor=2', '--lang=en-US'],
        cwd: ROOT,
        env: { ...env, LANG: 'en_US.UTF-8' },
    })
    win = await app.firstWindow()
    await viewport()
    await win.keyboard.press('Escape')
}

beforeAll(async () => {
    if (!fs.existsSync(join(ROOT, 'out/main/index.js'))) throw new Error('先に npm run build でアプリをビルドしてください')
    fs.mkdirSync(OUT, { recursive: true })
    // 画面に出るパスを短くするため、Windows 以外は /tmp に作る
    tmp = fs.mkdtempSync(join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'ClauseDown-manual-'))
    const base = join(tmp, 'repos')
    dirs.rules = join(base, 'Acme_Internal_Rules')
    dirs.contracts = join(base, 'Acme_Contracts')
    dirs.city = join(base, 'Riverside_City_Grants')
    dirs.houritsu = join(base, 'SAMPLE_houritsu')
    dirs.beta = join(base, 'Beta_Co')
    repos.push(
        { name: 'SAMPLE_houritsu', dir: dirs.houritsu },
        { name: 'Acme_Internal_Rules', dir: dirs.rules, section: 'Acme Corp.' },
        { name: 'Acme_Contracts', dir: dirs.contracts, url: 'https://github.com/example-office/contracts.git', section: 'Acme Corp.' },
        { name: 'Riverside_City_Grants', dir: dirs.city, section: 'Riverside City' },
    )
    await seedRules(dirs.rules)
    await seedContracts(dirs.contracts)
    await seedCity(dirs.city)
    await seedHouritsu(dirs.houritsu)
    await seedBeta(dirs.beta)

    // 初めて起動したときの画面は、リポジトリも名前もない設定で別に起動して撮る
    if (want('first-launch.png')) {
        await launch('first', { repos: [], author: { name: '', email: '' }, username: '', theme: 'light', prefs: PREFS })
        await seen('Getting started', 60000)
        await save('first-launch.png')
        await app.close()
    }
    await launch('main', { repos, author: ME, username: '', current: dirs.rules, theme: 'light', prefs: PREFS, ai: { provider: 'ollama', model: 'gemma3' } })
    await seen('Upcoming due dates', 60000)
    await wait(1000)
}, 600000)

afterAll(async () => {
    await app?.close().catch(() => {})
    for (const f of COPIED) if (!ONLY.length || ONLY.includes(f)) fs.copyFileSync(join(JA_IMAGES, f), join(OUT, f))
    if (tmp && !process.env.KEEP) fs.rmSync(tmp, { recursive: true, force: true })
    for (const f of temps) fs.rmSync(f, { force: true })
    if (failed.length) console.log(`撮れなかった画面: ${failed.join(', ')}`)
})

describe('manual screenshots (en)', () => {
    for (const s of shots) {
        const name = s.names.join(', ')
        it.skipIf(!s.names.some(want))(
            name,
            async () => {
                await viewport()
                try {
                    await s.fn()
                } catch (e) {
                    failed.push(name)
                    await win.screenshot({ path: join(tmp, `failed-${s.names[0]}`) }).catch(() => {})
                    throw e
                } finally {
                    await reset().catch(() => {})
                }
            },
            180000,
        )
    }
})
