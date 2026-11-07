/// <reference types="vite/client" />
import fs, { promises as fsp } from 'node:fs'
import { dirname, join } from 'node:path'
import git from './igit'

const SOURCES = import.meta.glob('../../example_repository/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const ROOT = '../../example_repository/'

const PEOPLE: Record<string, string> = {
    山田: 'yamada@example.com',
    佐藤: 'sato@example.com',
    鈴木: 'suzuki@example.com',
}

type Edit = [path: string, now: string, before: string]

interface EventInput {
    kind: string
    title: string
    docPath: string
    date: string
    end?: string
    repeat?: { every: 'year' | 'month' }
    done?: string[]
}

function sourceFiles(folder: string): Map<string, string> {
    const prefix = `${ROOT}${folder}/`
    const out = new Map<string, string>()
    for (const [key, text] of Object.entries(SOURCES)) {
        if (key.startsWith(prefix)) out.set(key.slice(prefix.length), text.replace(/\r\n/g, '\n'))
    }
    if (!out.size) throw new Error(`サンプルの文書が見つかりません：${folder}`)
    return out
}

function fromToday(days: number): string {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const signature = (who: string, date: string) => ({
    name: who,
    email: PEOPLE[who],
    timestamp: Math.floor(new Date(`${date}T10:00:00+09:00`).getTime() / 1000),
    timezoneOffset: -540,
})

class SampleRepo {
    private records = new Map<string, unknown>()
    private seq = 0
    private date = '2025-01-01'

    constructor(
        readonly dir: string,
        private files: Map<string, string>,
    ) {}

    private full(p: string) {
        return join(this.dir, ...p.split('/'))
    }

    private async write(p: string, text: string) {
        await fsp.mkdir(dirname(this.full(p)), { recursive: true })
        await fsp.writeFile(this.full(p), text, 'utf8')
    }

    private replace(text: string, p: string, from: string, to: string) {
        if (!text.includes(from)) throw new Error(`サンプルの ${p} に「${from}」がありません`)
        return text.replace(from, to)
    }

    async init() {
        await fsp.mkdir(this.dir, { recursive: true })
        await git.init({ fs, dir: this.dir, defaultBranch: 'main' })
    }

    async writeAll(edits: Edit[] = []) {
        for (const [p, text] of this.files) {
            let t = text
            for (const [doc, now, before] of edits) if (doc === p) t = this.replace(t, p, now, before)
            await this.write(p, t)
        }
    }

    async writeExtra(p: string, text: string) {
        await this.write(p, text)
    }

    async edit(p: string, from: string, to: string) {
        await this.write(p, this.replace(await fsp.readFile(this.full(p), 'utf8'), p, from, to))
    }

    async save(date: string, message: string, who: string, effective?: string, docs: string[] = []) {
        this.date = date
        const { dir } = this
        for (const [path, head, work, stage] of await git.statusMatrix({ fs, dir })) {
            if (work === 0) await git.remove({ fs, dir, filepath: path })
            else if (head !== work || work !== stage) await git.add({ fs, dir, filepath: path })
        }
        const sig = signature(who, date)
        await git.commit({ fs, dir, message: effective ? `${message}\n\n施行日: ${effective}` : message, author: sig, committer: sig })
        for (const d of effective ? docs : []) {
            await git.annotatedTag({ fs, dir, ref: `施行/${d.replace(/\.md$/, '')}/${effective}`, message: `${d} 施行日 ${effective}`, tagger: sig, force: true })
        }
    }

    async draft(label: string, date: string, who: string, changes: [string, string, string][], message: string, request?: string) {
        const { dir } = this
        await git.branch({ fs, dir, ref: `案/${label}`, checkout: true })
        for (const [p, from, to] of changes) await this.edit(p, from, to)
        await this.save(date, message, who)
        if (request) {
            const id = this.newId()
            const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
            this.records.set(`reviews/${id}.json`, { id, branch: `案/${label}`, action: 'request', oid, by: who, at: this.at(), text: request, source: 'app' })
        }
        await git.checkout({ fs, dir, ref: 'main' })
    }

    event(e: EventInput) {
        const id = this.newId()
        this.records.set(`events/${id}.json`, { id, done: [], by: '山田', at: this.at(), updatedAt: this.at(), ...e })
    }

    async finish() {
        if (!this.records.size) return
        const { dir } = this
        this.records.set('settings/rules.json', { requireApproval: true, approvers: ['山田'] })
        const folders = new Map<string, { mode: string; path: string; oid: string; type: 'blob' }[]>()
        for (const [file, data] of this.records) {
            const [folder, name] = file.split('/')
            const oid = await git.writeBlob({ fs, dir, blob: Buffer.from(JSON.stringify(data, null, 2), 'utf8') })
            folders.set(folder, [...(folders.get(folder) ?? []), { mode: '100644', path: name, oid, type: 'blob' }])
        }
        const root = []
        for (const [folder, entries] of folders) {
            root.push({ mode: '040000', path: folder, oid: await git.writeTree({ fs, dir, tree: entries }), type: 'tree' as const })
        }
        const tree = await git.writeTree({ fs, dir, tree: root })
        const sig = signature('山田', this.date)
        const oid = await git.writeCommit({ fs, dir, commit: { message: '記録を作成', tree, parent: [], author: sig, committer: sig } })
        await git.writeRef({ fs, dir, ref: 'refs/heads/clausedown-records', value: oid, force: true })
    }

    private at() {
        return new Date(`${this.date}T10:00:00+09:00`).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }

    private newId() {
        return `${this.at().replace(/[-:TZ]/g, '').slice(0, 14)}-ex${String(++this.seq).padStart(4, '0')}`
    }
}

interface Sample {
    name: string
    folder: string
    build(r: SampleRepo): Promise<void>
}

const RULE = '就業規則.md'
const AMENDED_2026 = '\n\n## 附則（２０２６年４月１日改正） {supplement}\n\n### 施行期日\n- この規則は、２０２６年４月１日から施行する。'
const ORDINANCE = '見本市空き家等の適正管理に関する条例.md'
const OUTLINE = '見本市空き家改修費補助金交付要綱.md'

const SAMPLES: Sample[] = [
    {
        name: 'SAMPLE_見本株式会社_社内規程',
        folder: '社内規程',
        async build(r) {
            await r.writeAll([
                [RULE, '年５日を限度に', '年３日を限度に'],
                [RULE, '月額５０，０００円までの範囲内', '月額３０，０００円までの範囲内'],
                [RULE, AMENDED_2026, ''],
            ])
            await r.save('2025-02-03', '厚生労働省のモデル就業規則をもとに作成', '山田', '2025-04-01', [RULE])
            await r.writeAll()
            await r.save('2026-02-10', '不妊治療休暇の日数と通勤手当の上限を引上げ', '佐藤', '2026-04-01', [RULE])
            await r.draft(
                '2027年4月改定',
                '2026-10-20',
                '佐藤',
                [
                    [RULE, '  - 兄弟姉妹、祖父母、配偶者の父母又は兄弟姉妹が死亡したとき　２日\n', '  - 兄弟姉妹、祖父母、配偶者の父母又は兄弟姉妹が死亡したとき　２日\n  - 子が小学校に入学するとき　１日\n'],
                    [RULE, AMENDED_2026, `${AMENDED_2026}\n\n## 附則（２０２７年４月１日改正） {supplement}\n\n### 施行期日\n- この規則は、２０２７年４月１日から施行する。`],
                ],
                '慶弔休暇に子の入学を追加',
                '子の入学の慶弔休暇を追加しました。確認をお願いします。',
            )
            r.event({ kind: 'notify', title: '労働基準監督署への届出（2026年改定）', docPath: RULE, date: '2026-03-13', done: ['2026-03-13'] })
            r.event({ kind: 'notify', title: '労働基準監督署への届出（2027年改定）', docPath: RULE, date: '2027-03-12' })
            r.event({ kind: 'renew', title: '36協定の更新', docPath: '', date: '2026-03-31', repeat: { every: 'year' }, done: ['2026-03-31'] })
            r.event({ kind: 'deadline', title: '改定案の社内意見の締切', docPath: RULE, date: fromToday(-3) })
            r.event({ kind: 'submit', title: '改定案を取締役会に提出', docPath: RULE, date: fromToday(14) })
        },
    },
    {
        name: 'SAMPLE_見本_契約書',
        folder: '契約書',
        async build(r) {
            await r.writeAll([
                ['業務委託契約書.md', '月額300,000円', '月額250,000円'],
                ['業務委託契約書.md', '本契約の終了後3年間存続する', '本契約の終了後2年間存続する'],
                ['著作権譲渡契約書.md', '金1,000,000円', '金800,000円'],
                ['著作権譲渡契約書.md', '。ただし、題名の変更については、甲は事前に乙と協議する。', '。'],
            ])
            await r.save('2026-02-16', '業務委託契約書・著作権譲渡契約書の案を作成', '鈴木')
            await r.writeAll()
            await r.save('2026-03-18', '相手方との協議を反映（委託料・秘密保持の期間・対価・題名の変更）', '鈴木', '2026-04-01', ['業務委託契約書.md'])
            await r.draft('2027年度の更新', '2026-11-02', '鈴木', [['業務委託契約書.md', '月額300,000円', '月額320,000円']], '2027年度の委託料を改定')
            r.event({ kind: 'start', title: '業務委託の開始', docPath: '業務委託契約書.md', date: '2026-04-01' })
            r.event({ kind: 'end', title: '業務委託の期間満了', docPath: '業務委託契約書.md', date: '2027-03-31' })
            r.event({ kind: 'deadline', title: '更新しない旨の申出の期限', docPath: '業務委託契約書.md', date: '2027-02-28' })
            r.event({ kind: 'deadline', title: '対価の支払期限', docPath: '著作権譲渡契約書.md', date: '2026-05-31', done: ['2026-05-31'] })
            r.event({ kind: 'apply', title: '著作権の移転の登録', docPath: '著作権譲渡契約書.md', date: '2026-06-30', done: ['2026-06-30'] })
            r.event({ kind: 'deadline', title: '更新後の委託料の提示', docPath: '業務委託契約書.md', date: fromToday(21) })
        },
    },
    {
        name: 'SAMPLE_見本市_条例・要綱',
        folder: '条例・要綱',
        async build(r) {
            await r.writeAll([
                [OUTLINE, '500,000円を限度とする', '300,000円を限度とする'],
                [OUTLINE, '\n- この要綱の改正は、2026年10月1日から施行する。', ''],
            ])
            await r.save('2026-01-08', '条例案と補助金交付要綱を作成', '山田', '2026-04-01', [ORDINANCE, OUTLINE])
            await r.writeAll()
            await r.save('2026-08-25', '補助金の上限を500,000円に引上げ', '佐藤', '2026-10-01', [OUTLINE])
            await r.draft(
                '2027年改正',
                '2026-10-30',
                '佐藤',
                [[ORDINANCE, '## 活用の促進', '### 緊急安全措置\n- 市長は、管理不全空き家等の倒壊等により人の生命、身体又は財産に危害が及ぶおそれがあり、緊急の必要があると認めるときは、その危害を避けるために必要な最小限度の措置をとることができる。\n\n## 活用の促進']],
                '緊急安全措置の規定を追加',
                '緊急安全措置の条を追加しました。法務担当の確認をお願いします。',
            )
            r.event({ kind: 'deadline', title: 'パブリックコメントの締切', docPath: ORDINANCE, date: '2026-01-30', done: ['2026-01-30'] })
            r.event({ kind: 'submit', title: '市議会への提出', docPath: ORDINANCE, date: '2026-02-20', done: ['2026-02-20'] })
            r.event({ kind: 'promulgate', title: '条例の公布', docPath: ORDINANCE, date: '2026-03-25' })
            r.event({ kind: 'deadline', title: '補助金の申請受付', docPath: OUTLINE, date: '2026-05-01', end: '2027-01-29' })
            r.event({ kind: 'submit', title: '2027年改正案の議会提出', docPath: ORDINANCE, date: '2027-02-19' })
            r.event({ kind: 'start', title: '改正案のパブリックコメント', docPath: ORDINANCE, date: fromToday(7), end: fromToday(37) })
        },
    },
    {
        name: 'SAMPLE_houritsu_法令',
        folder: 'houritsu',
        async build(r) {
            await r.writeAll()
            await r.writeExtra(
                '出典.txt',
                '出典：e-Gov法令検索（https://laws.e-gov.go.jp/）、PDL1.0\nhouritsu（https://github.com/Kohei-Wada/houritsu、CC BY 4.0）の Markdown をそのまま使っています。\n',
            )
            await r.save('2026-11-01', 'houritsu から 3 件の法令を取得', '山田')
        },
    },
]

async function freeName(parent: string, name: string): Promise<string> {
    for (let i = 1; ; i++) {
        const candidate = i === 1 ? name : `${name}（${i}）`
        const dir = join(parent, candidate)
        if (!fs.existsSync(dir) || !(await fsp.readdir(dir)).length) return candidate
    }
}

export async function createSamples(parent: string): Promise<{ name: string; dir: string }[]> {
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('フォルダが見つかりません')
    const made: { name: string; dir: string }[] = []
    for (const s of SAMPLES) {
        const name = await freeName(parent, s.name)
        const dir = join(parent, name)
        const r = new SampleRepo(dir, sourceFiles(s.folder))
        try {
            await r.init()
            await s.build(r)
            await r.finish()
        } catch (e) {
            await fsp.rm(dir, { recursive: true, force: true })
            throw e
        }
        made.push({ name, dir })
    }
    return made
}
