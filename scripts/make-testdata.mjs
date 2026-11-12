import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PARENT = path.resolve(process.argv[2])
const DELIVER = path.resolve(process.argv[3])
if (fs.existsSync(PARENT)) throw new Error(`すでにあります: ${PARENT}`)
fs.mkdirSync(PARENT, { recursive: true })
fs.mkdirSync(DELIVER, { recursive: true })

const PEOPLE = {
    山田: 'yamada@office.example',
    事務員A: 'staff-a@office.example',
    事務員B: 'staff-b@office.example',
}

let now = new Date('2024-01-09T10:00:00+09:00')
const SPREAD = 2.8
function tick(days = 3, hours = 2) {
    now = new Date(now.getTime() + days * SPREAD * 86400000 + hours * 3600000)
    return now
}
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
const gitDate = (d) => `${Math.floor(d.getTime() / 1000)} +0900`

const repos = []

function createRepo(name, client, kind, by = '山田') {
    const ROOT = path.join(PARENT, name)
    fs.mkdirSync(ROOT, { recursive: true })

    function git(args, who = '山田', input) {
        const env = {
            ...process.env,
            GIT_AUTHOR_NAME: who,
            GIT_AUTHOR_EMAIL: PEOPLE[who],
            GIT_COMMITTER_NAME: who,
            GIT_COMMITTER_EMAIL: PEOPLE[who],
            GIT_AUTHOR_DATE: gitDate(now),
            GIT_COMMITTER_DATE: gitDate(now),
        }
        return execFileSync('git', ['-C', ROOT, ...args], { env, input, encoding: 'utf8' }).trim()
    }

    const full = (p) => path.join(ROOT, ...p.split('/'))
    function write(p, text) {
        fs.mkdirSync(path.dirname(full(p)), { recursive: true })
        fs.writeFileSync(full(p), text.replace(/^\n/, ''), 'utf8')
    }
    const read = (p) => fs.readFileSync(full(p), 'utf8')
    function edit(p, from, to) {
        const s = read(p)
        if (!s.includes(from)) throw new Error(`${name}/${p} に「${from}」がありません`)
        fs.writeFileSync(full(p), s.replace(from, to), 'utf8')
    }

    function tagEffective(docPath, date, who = '山田', ref = 'HEAD') {
        const tag = `施行/${docPath.replace(/\.md$/, '')}/${date}`
        git(['tag', '-a', '-f', tag, '-m', `${docPath} 施行日 ${date}`, ref], who)
    }

    function save(message, who, opts = {}) {
        tick(opts.days ?? 3, opts.hours ?? 2)
        git(['add', '-A'], who)
        const msg = opts.effective ? `${message}\n\n施行日: ${opts.effective}` : message
        git(['commit', '-q', '-m', msg], who)
        const oid = git(['rev-parse', 'HEAD'])
        if (opts.effective) for (const d of opts.docs ?? []) tagEffective(d, opts.effective, who)
        return oid
    }

    const checkout = (ref) => git(['checkout', '-q', ref])
    const branch = (label, from = 'main') => git(['checkout', '-q', '-b', `案/${label}`, from])

    function adopt(label, who = '山田', opts = {}) {
        checkout('main')
        tick(opts.days ?? 2, 1)
        git(['merge', '-q', '--no-ff', `案/${label}`, '-m', `改定案「${label}」を現行版に反映${opts.effective ? `\n\n施行日: ${opts.effective}` : ''}`], who)
        const oid = git(['rev-parse', 'HEAD'])
        if (opts.effective) for (const d of opts.docs ?? []) tagEffective(d, opts.effective, who)
        if (opts.deleteAfter !== false) git(['branch', '-q', '-D', `案/${label}`])
        return oid
    }

    const records = { 'rules.json': { requireApproval: true, approvers: ['山田'] } }
    const oidOf = (ref) => git(['rev-parse', ref])

    function review(branchName, action, who, when, text, oid = oidOf(branchName)) {
        const id = idAt(when)
        records[`review-${id}.json`] = { id, branch: branchName, action, oid, by: who, at: iso(when), text, source: 'app' }
    }

    function deliver(docPath, title, effective, to, memo, items, who, when, baseRef) {
        const id = idAt(when)
        const oid = oidOf(`施行/${docPath.replace(/\.md$/, '')}/${effective}`)
        const peeled = git(['rev-parse', `${oid}^{commit}`])
        const stamp = iso(when).slice(0, 10).replace(/-/g, '')
        const folder = path.join(DELIVER, `${stamp}_${client}_${title}_納品`)
        const names = {
            docPdf: `${title}.pdf`,
            docDocx: `${title}.docx`,
            cmpPdf: `${title} 新旧対照表.pdf`,
            cmpDocx: `${title} 新旧対照表.docx`,
            opinion: '意見書（ひな形）.docx',
        }
        const files = items.map((i) => names[i])
        fs.mkdirSync(folder, { recursive: true })
        fs.writeFileSync(
            path.join(folder, 'このフォルダについて.txt'),
            `テストデータの納品物フォルダです（中身は空です）。\r\n\r\nリポジトリ：${name}\r\n宛先：${to}\r\n施行日：${effective}\r\n納品物：\r\n${files.map((f) => `- ${f}`).join('\r\n')}\r\n`,
            'utf8',
        )
        const baseOid = baseRef ? git(['rev-parse', `${baseRef}^{commit}`]) : undefined
        records[`delivery-${id}.json`] = {
            id,
            docPath,
            title,
            client,
            oid: peeled,
            baseOid,
            effectiveDate: effective,
            to,
            memo,
            items,
            files,
            folder,
            at: iso(when),
            by: who,
        }
        git(['tag', '-a', `納品/${docPath.replace(/\.md$/, '')}/${id}`, '-m', `${title} 納品（${to}）`, peeled], who)
    }

    function writeRecords() {
        const entries = Object.entries(records)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([file, data]) => {
                const blob = git(['hash-object', '-w', '--stdin'], '山田', JSON.stringify(data, null, 2))
                return `100644 blob ${blob}\t${file}`
            })
        const tree = git(['mktree'], '山田', entries.join('\n') + '\n')
        const rec = git(['commit-tree', tree, '-m', '記録を作成'], '山田')
        git(['update-ref', 'refs/heads/clausedown-records', rec])
        checkout('main')
    }

    function summary() {
        const count = (args) => git(args).split('\n').filter(Boolean).length
        return {
            folder: ROOT,
            commits: Number(git(['rev-list', '--all', '--count'])),
            branches: git(['branch', '--format=%(refname:short)']).split('\n'),
            effectiveTags: count(['tag', '-l', '施行/*']),
            deliveryTags: count(['tag', '-l', '納品/*']),
            reviews: Object.keys(records).filter((k) => k.startsWith('review-')).length,
            deliveries: Object.keys(records).filter((k) => k.startsWith('delivery-')).length,
        }
    }

    git(['init', '-q', '-b', 'main'])
    git(['config', 'core.autocrlf', 'false'])
    write('README.md', `# ${client} ${kind}\n\n社労士事務所が ${client} の${kind}を管理しているという想定のテスト用リポジトリです。\n`)
    save('リポジトリを作成', by, { days: 0 })

    const r = { name, client, kind, git, write, edit, save, branch, checkout, adopt, tagEffective, oidOf, review, deliver, writeRecords, summary }
    repos.push(r)
    return r
}

let seq = 0
const idAt = (d) =>
    `${d
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14)}-${(++seq).toString(36).padStart(6, '0')}`
const at = (offsetDays) => new Date(now.getTime() + offsetDays * 86400000)

const 就業規則 = (company) => `
# 就業規則

この規則は、${company}（以下「会社」という。）の従業員の労働条件及び服務規律を定めるものである。

## 総則

### 目的 {#目的}
- この規則は、労働基準法第89条に基づき、従業員の就業に関する事項を定める。
- この規則に定めのない事項は、労働基準法その他の法令の定めるところによる。

### 適用範囲 {#適用範囲}
- この規則は、会社に雇用される全ての従業員に適用する。
- 前項の規定にかかわらず、次に掲げる者については、別に定める規程を適用する。
  - パートタイム従業員
  - 有期契約従業員

### 規則の遵守
- 会社及び従業員は、この規則を遵守し、相互に協力して職責を果たさなければならない。

## 人事

### 採用手続
- 会社は、入社を希望する者の中から選考を経て従業員を採用する。

### 試用期間 {#試用期間}
- 新たに採用した者については、採用の日から3か月間を試用期間とする。
- 前項の期間は、会社が必要と認めたときは、短縮し、又は設けないことがある。

## 労働時間、休憩及び休日

### 労働時間 {#労働時間}
- 所定労働時間は、1週間について40時間、1日について8時間とする。
- 始業及び終業の時刻は、次のとおりとする。
  - 始業　午前9時
  - 終業　午後6時

### 休憩
- 会社は、労働時間が6時間を超える場合は45分、8時間を超える場合は1時間の休憩時間を与える。

### 休日 {#休日}
- 休日は、次のとおりとする。
  - 土曜日及び日曜日
  - 国民の祝日
  - 年末年始（12月29日から1月3日まで）

## 休暇

### 年次有給休暇 {#年休}
- 採用日から6か月間継続勤務し、所定労働日の8割以上出勤した従業員に対しては、10日の年次有給休暇を与える。

### 育児休業 {#育休}
- 1歳に満たない子を養育する従業員は、申出により育児休業をすることができる。

## 附則 {supplement}
- この規則は、2024年4月1日から施行する。
`

const 賃金規程 = `
# 賃金規程

## 総則

### 目的 {#目的}
- この規程は、就業規則に基づき、従業員の賃金に関する事項を定める。

### 賃金の構成 {#構成}
- 賃金の構成は、次のとおりとする。
  - 基本給
  - 諸手当
  - 割増賃金

## 手当

### 諸手当 {#手当}
- 諸手当の額は、次の表のとおりとする。

  | 手当 | 支給対象 | 月額 |
  |---|---|---|
  | 住宅手当 | 世帯主 | 10,000円 |
  | 家族手当 | 扶養家族1人につき | 5,000円 |
  | 通勤手当 | 全員 | 実費（上限30,000円） |

- [[構成]]の諸手当の支給手続は、次のとおりとする。

  \`\`\`mermaid
  flowchart LR
    A[従業員が申請] --> B[所属長が確認]
    B --> C[人事部が承認]
    C --> D[翌月の給与で支給]
  \`\`\`

### 割増賃金
- 時間外労働に対しては、通常の賃金の2割5分増しの割増賃金を支給する。

## 支払

### 支給日 {#支給日}
- 賃金は、毎月25日に支給する。ただし、休日に当たるときは前日とする。

### 支払方法
- 賃金は、従業員の同意を得て、従業員が指定する金融機関の口座に振り込む。

## 別表第一 基本給表 {appendix}
| 等級 | 基本給（月額） |
|---|---|
| 1級 | 200,000円 |
| 2級 | 230,000円 |
| 3級 | 260,000円 |
`

const 育休規程 = `
# 育児・介護休業規程

## 育児休業

### 対象者 {#対象者}
- 育児のために休業することを希望する従業員であって、1歳に満たない子と同居し、養育する者は、この規程に定めるところにより育児休業をすることができる。

### 申出の手続 {#申出}
- 育児休業をすることを希望する従業員は、原則として育児休業を開始しようとする日の1か月前までに、育児休業申出書を人事部に提出する。

## 介護休業

### 介護休業 {#介護}
- 要介護状態にある家族を介護する従業員は、対象家族1人につき通算93日まで、3回を上限として介護休業をすることができる。

## 附則 {supplement}
- この規程は、2024年4月1日から施行する。
`

const 雇用契約書 = `
# 雇用契約書
<!-- clausedown
article: { title: inline }
paragraph: { numeral: arabic }
item: { style: paren }
-->

B商店（以下「甲」という。）と従業員（以下「乙」という。）は、次のとおり雇用契約を締結する。

### 契約期間
- 期間の定めなし。

### 就業の場所
- 甲の本店及び甲が指定する場所とする。

### 業務の内容
- 店舗における販売業務及びこれに付随する業務とする。

### 賃金
- 賃金は、次のとおりとする。
  - 基本給　月額200,000円
  - 通勤手当　実費

## {closing}
以上の契約の成立を証するため、本書2通を作成し、甲乙記名押印の上、各1通を保有する。
`

const 業務委託契約書 = `
# 業務委託契約書
<!-- clausedown
article: { title: inline }
paragraph: { firstNumbered: true, numeral: arabic }
item: { style: paren }
-->

C法律事務所（以下「委託者」という。）と当事務所（以下「受託者」という。）は、次のとおり業務委託契約を締結する。

### 目的 {#目的}
- 委託者は、受託者に対し、労務管理に関する相談業務（以下「本業務」という。）を委託し、受託者はこれを受託する。

### 委託料 {#委託料}
- 委託料は、月額50,000円（消費税別）とする。
- 委託者は、前項の委託料を、毎月末日までに受託者の指定する口座に振り込む。

### 契約期間 {#期間}
- 本契約の期間は、2024年4月1日から2025年3月31日までとする。
- 期間満了の1か月前までにいずれからも申出がないときは、同一条件で1年間更新する。

### 秘密保持
- 受託者は、本業務に関して知り得た委託者の秘密を第三者に漏らしてはならない。

### 解除
- 委託者又は受託者は、相手方が[[委託料]]その他本契約の定めに違反したときは、本契約を解除することができる。

## {closing}
本契約の成立を証するため、本書2通を作成し、各自記名押印の上、各1通を保有する。
`

const 旅費規程 = `
# 旅費規程

## 総則

### 目的
- この規程は、従業員が業務のため出張する場合の旅費に関する事項を定める。

### 旅費の種類 {#種類}
- 旅費は、交通費、宿泊料及び日当とする。

## 支給額

### 宿泊料 {#宿泊料}
- 宿泊料の額は、次の表のとおりとする。

  | 区分 | 1泊あたり |
  |---|---|
  | 役員 | 15,000円 |
  | 従業員 | 10,000円 |

### 日当
- 日当は、1日につき2,000円とする。

## 附則 {supplement}
- この規程は、2025年10月1日から施行する。
`

const 秘密保持契約書 = `
# 秘密保持契約書
<!-- clausedown
article: { title: inline }
paragraph: { numeral: arabic }
-->

### 秘密情報 {#秘密情報}
- 本契約において秘密情報とは、開示者が受領者に開示した技術上又は営業上の情報をいう。

### 秘密保持義務
- 受領者は、[[秘密情報]]を厳重に管理し、第三者に開示してはならない。

### 有効期間
- 本契約の有効期間は、締結日から3年間とする。
`

const A規程 = createRepo('株式会社A_規程', '株式会社A', '規程類')
const B規程 = createRepo('B商店_規程', 'B商店', '規程類', '事務員B')
const B契約 = createRepo('B商店_契約書', 'B商店', '契約書', '事務員B')
const C契約 = createRepo('C法律事務所_契約書', 'C法律事務所', '契約書')
const D規程 = createRepo('合同会社D_規程', '合同会社D', '規程類', '事務員A')
const 事務所契約 = createRepo('事務所_契約書ひな形', '事務所', '契約書ひな形')

A規程.write('就業規則.md', 就業規則('株式会社A'))
A規程.save('就業規則の初版を作成', '山田')
A規程.write('賃金規程.md', 賃金規程)
A規程.save('賃金規程の初版を作成', '事務員A')
A規程.write('育児・介護休業規程.md', 育休規程)
A規程.save('育児・介護休業規程の初版を作成', '事務員A')
B規程.write('就業規則.md', 就業規則('B商店'))
B規程.save('就業規則の初版を作成', '事務員B')
B契約.write('雇用契約書.md', 雇用契約書)
B契約.save('雇用契約書のひな形を作成', '事務員B')
C契約.write('業務委託契約書.md', 業務委託契約書)
C契約.save('業務委託契約書を作成', '山田')
D規程.write('就業規則.md', 就業規則('合同会社D'))
D規程.save('就業規則の初版を作成', '事務員A')

A規程.edit('就業規則.md', '新たに採用した者', '新たに採用した従業員')
A規程.save('第5条 表現を統一', '山田', {
    effective: '2024-04-01',
    docs: ['就業規則.md', '賃金規程.md', '育児・介護休業規程.md'],
})
B規程.tagEffective('就業規則.md', '2024-04-01')
C契約.tagEffective('業務委託契約書.md', '2024-04-01')
D規程.tagEffective('就業規則.md', '2024-05-01')

B規程.edit('就業規則.md', '午後6時', '午後5時30分')
B規程.save('終業時刻を変更', '事務員B', { days: 20 })
D規程.edit('就業規則.md', '採用の日から3か月間', '採用の日から2か月間')
D規程.save('試用期間を2か月に短縮', '事務員A', { days: 12 })
A規程.edit('賃金規程.md', '2割5分増し', '2割5分増し（月60時間を超える部分は5割増し）')
A規程.save('割増賃金に月60時間超の率を追加', '山田', { days: 9 })

A規程.branch('2025年4月改定')
A規程.edit('就業規則.md', '  - 国民の祝日\n', '  - 国民の祝日\n  - 夏季休暇（8月13日から8月15日まで）\n')
A規程.save('第9条 休日に夏季休暇を追加', '事務員A', { days: 15 })
A規程.edit('就業規則.md', '1歳に満たない子', '1歳（保育所に入所できない等の事情がある場合は2歳）に満たない子')
A規程.save('第11条 育児休業の対象を延長', '事務員A')
A規程.edit('賃金規程.md', '| 住宅手当 | 世帯主 | 10,000円 |', '| 住宅手当 | 世帯主 | 12,000円 |')
A規程.save('第3条 住宅手当を12,000円に引き上げ', '事務員B')
A規程.adopt('2025年4月改定', '山田', { effective: '2025-04-01', docs: ['就業規則.md', '賃金規程.md'], days: 25 })

B契約.branch('雇用契約見直し')
B契約.edit(
    '雇用契約書.md',
    '- 期間の定めなし。',
    '- 2025年7月1日から2026年6月30日までの1年間とする。\n- 契約の更新は、乙の勤務成績及び甲の業務量により判断する。',
)
B契約.save('第1条 有期契約に変更し更新基準を明記', '事務員B', { days: 30 })
B契約.edit('雇用契約書.md', '月額200,000円', '月額210,000円')
B契約.save('第4条 基本給を改定', '事務員B')
B契約.adopt('雇用契約見直し', '山田', { effective: '2025-07-01', docs: ['雇用契約書.md'], deleteAfter: false })

D規程.branch('旅費規程新設')
D規程.write('旅費規程.md', 旅費規程)
D規程.save('旅費規程を新設', '事務員A', { days: 18 })
D規程.edit('旅費規程.md', '1日につき2,000円', '1日につき2,500円')
D規程.save('第5条 日当を見直し', '山田')
D規程.adopt('旅費規程新設', '山田', { effective: '2025-10-01', docs: ['旅費規程.md'] })

C契約.edit('業務委託契約書.md', '2024年4月1日から2025年3月31日まで', '2025年4月1日から2026年3月31日まで')
C契約.save('第3条 契約期間を更新', '山田', { effective: '2025-04-01', docs: ['業務委託契約書.md'], days: 10 })
A規程.edit('就業規則.md', '10日の年次有給休暇', '10日の年次有給休暇（勤続年数に応じて最大20日）')
A規程.save('第10条 年次有給休暇の日数を明記', '事務員A', { days: 21 })
B規程.edit('就業規則.md', '### 規則の遵守\n- 会社及び従業員は、この規則を遵守し、相互に協力して職責を果たさなければならない。\n', '### {deleted}\n')
B規程.save('第3条（規則の遵守）を削除', '事務員B', { days: 8 })

A規程.branch('2026年10月改定')
A規程.edit('育児・介護休業規程.md', '原則として育児休業を開始しようとする日の1か月前までに', '原則として育児休業を開始しようとする日の2週間前までに')
A規程.save('第2条 申出期限を2週間前に短縮', '事務員A', { days: 40 })
A規程.edit('育児・介護休業規程.md', '### 介護休業 {#介護}', '### 介護休業 {#介護}\n- 会社は、従業員が40歳に達したときに、介護休業制度について個別に周知する。')
A規程.save('第3条 40歳時点の個別周知を追加', '事務員A')
A規程.edit(
    '就業規則.md',
    '- 1歳（保育所に入所できない等の事情がある場合は2歳）に満たない子を養育する従業員は、申出により育児休業をすることができる。',
    '- 1歳（保育所に入所できない等の事情がある場合は2歳）に満たない子を養育する従業員は、申出により育児休業をすることができる。\n- 3歳から小学校就学前の子を養育する従業員は、柔軟な働き方を実現するための措置を選択して利用することができる。',
)
A規程.save('第11条 柔軟な働き方の措置を追加', '事務員B')

A規程.branch('2026年10月改定-文言調整', '案/2026年10月改定')
A規程.edit('就業規則.md', '柔軟な働き方を実現するための措置', '柔軟な働き方を実現するための措置（始業時刻等の変更、テレワーク等）')
A規程.save('第11条 措置の例を明記', '山田', { days: 4 })

A規程.checkout('main')
A規程.edit(
    '育児・介護休業規程.md',
    '原則として育児休業を開始しようとする日の1か月前までに',
    '原則として育児休業を開始しようとする日の1か月前（出生時育児休業は2週間前）までに',
)
A規程.save('第2条 出生時育児休業の申出期限を追記', '山田', { days: 6 })

A規程.branch('賃金改定2027')
A規程.edit('賃金規程.md', '| 住宅手当 | 世帯主 | 12,000円 |', '| 住宅手当 | 世帯主 | 15,000円 |')
A規程.edit('賃金規程.md', '実費（上限30,000円）', '実費（上限50,000円）')
A規程.save('第3条 住宅手当と通勤手当の上限を引き上げ', '事務員B', { days: 12 })
A規程.edit('賃金規程.md', '| 2級 | 230,000円 |', '| 2級 | 240,000円 |')
A規程.edit('賃金規程.md', '| 3級 | 260,000円 |', '| 3級 | 275,000円 |')
A規程.save('別表第一 基本給表を改定', '事務員B')
A規程.checkout('main')
A規程.edit('賃金規程.md', '毎月25日に支給する', '毎月20日に支給する')
A規程.save('第5条 支給日を20日に変更', '山田', { days: 5 })

C契約.branch('契約更新')
C契約.edit('業務委託契約書.md', '月額50,000円（消費税別）', '月額60,000円（消費税別）')
C契約.save('第2条 委託料を改定', '事務員A', { days: 9 })
C契約.edit('業務委託契約書.md', '2025年4月1日から2026年3月31日まで', '2026年4月1日から2027年3月31日まで')
C契約.save('第3条 契約期間を更新', '事務員A')
C契約.checkout('main')
C契約.edit('業務委託契約書.md', '月額50,000円（消費税別）', '月額55,000円（消費税別）')
C契約.save('第2条 委託料を暫定改定', '山田', { days: 3 })

B規程.branch('就業規則全面見直し')
B規程.edit(
    '就業規則.md',
    '## 人事',
    '## 人事\n\n### 労働条件の明示 {#明示}\n- 会社は、従業員を採用するときは、賃金、労働時間その他の労働条件を書面で明示する。',
)
B規程.save('第4条 労働条件の明示を追加', '事務員B', { days: 7 })
B規程.edit(
    '就業規則.md',
    '### 試用期間 {#試用期間}',
    '### 試用期間の延長 {branch}\n- 会社は、必要と認めたときは、試用期間を最長3か月延長することがある。\n\n### 試用期間 {#試用期間}',
)
B規程.save('試用期間の延長を枝番号の条で追加', '事務員B')
B規程.edit('就業規則.md', '45分', '1時間')
B規程.save('第8条 休憩時間を1時間に統一', '事務員B')
B規程.edit(
    '就業規則.md',
    '## 附則 {supplement}',
    '## 服務規律\n\n### 服務の基本\n- 従業員は、[[目的]]の趣旨に従い、誠実に職務を遂行しなければならない。\n\n### ハラスメントの禁止\n- 従業員は、職場におけるあらゆるハラスメントを行ってはならない。\n\n## 附則 {supplement}',
)
B規程.save('服務規律の章を新設', '山田')
B規程.edit(
    '就業規則.md',
    '- この規則は、2024年4月1日から施行する。',
    '- この規則は、2024年4月1日から施行する。\n- この規則の改正は、2026年4月1日から施行する。',
)
B規程.save('附則 改正の施行日を追加', '事務員B')

事務所契約.branch('ひな形整備')
事務所契約.write('秘密保持契約書.md', 秘密保持契約書)
事務所契約.save('秘密保持契約書のひな形を作成', '山田', { days: 11 })
事務所契約.edit('秘密保持契約書.md', '締結日から3年間', '締結日から5年間')
事務所契約.save('第3条 有効期間を5年に延長', '事務員A')

D規程.checkout('main')
D規程.edit('就業規則.md', '午前9時', '午前8時30分')
D規程.edit('就業規則.md', '午後6時', '午後5時30分')
D規程.save('始業・終業時刻を変更', '事務員A', { days: 14, effective: '2026-04-01', docs: ['就業規則.md'] })
D規程.edit('旅費規程.md', '| 従業員 | 10,000円 |', '| 従業員 | 11,000円 |')
D規程.save('第3条 宿泊料を見直し', '山田', { days: 2, effective: '2026-04-01', docs: ['旅費規程.md'] })
A規程.edit('就業規則.md', '会社に雇用される全ての従業員', '会社に雇用される全ての正社員')
A規程.save('第2条 適用範囲の表現を修正', '事務員B', { days: 4 })

A規程.review('案/2026年10月改定', 'request', '事務員A', at(-30), '育児・介護休業法の改正対応です。ご確認をお願いします。')
A規程.review('案/2026年10月改定', 'comment', '山田', at(-29), '第11条の措置は、会社が選ぶ2つ以上の措置であることが分かるようにしてください。')
A規程.review('案/2026年10月改定', 'changes', '山田', at(-28), '第11条の表現を見直してください。')
A規程.review('案/2026年10月改定', 'request', '事務員A', at(-10), '第11条を直しました。再度ご確認をお願いします。')
A規程.review('案/賃金改定2027', 'request', '事務員B', at(-20), '2027年度の賃金改定案です。')
A規程.review('案/賃金改定2027', 'approve', '山田', at(-18), '承認します。')
C契約.review('案/契約更新', 'request', '事務員A', at(-5), '委託料と期間の更新案です。')
const bOld = B規程.oidOf('案/就業規則全面見直し~1')
B規程.review('案/就業規則全面見直し', 'request', '事務員B', at(-15), '全面見直し案です。', bOld)
B規程.review('案/就業規則全面見直し', 'approve', '山田', at(-14), 'OK です。', bOld)
事務所契約.review('案/ひな形整備', 'request', '山田', at(-3), '秘密保持契約書のひな形です。')

A規程.deliver(
    '就業規則.md',
    '就業規則',
    '2024-04-01',
    '株式会社A 人事部 田中様',
    '初回の作成分',
    ['docPdf', 'docDocx', 'opinion'],
    '山田',
    new Date('2024-03-15T15:00:00+09:00'),
)
A規程.deliver('賃金規程.md', '賃金規程', '2024-04-01', '株式会社A 人事部 田中様', '', ['docPdf', 'docDocx'], '事務員A', new Date('2024-03-15T15:30:00+09:00'))
A規程.deliver(
    '就業規則.md',
    '就業規則',
    '2025-04-01',
    '株式会社A 人事部 田中様',
    '2025年4月改定分（夏季休暇・育休延長）',
    ['docPdf', 'docDocx', 'cmpPdf', 'cmpDocx', 'opinion'],
    '山田',
    new Date('2025-03-10T11:00:00+09:00'),
    '施行/就業規則/2024-04-01',
)
A規程.deliver(
    '賃金規程.md',
    '賃金規程',
    '2025-04-01',
    '株式会社A 人事部 田中様',
    '住宅手当の改定',
    ['docPdf', 'cmpPdf'],
    '事務員B',
    new Date('2025-03-10T11:30:00+09:00'),
    '施行/賃金規程/2024-04-01',
)
B規程.deliver('就業規則.md', '就業規則', '2024-04-01', 'B商店 店主 鈴木様', '', ['docPdf', 'opinion'], '事務員B', new Date('2024-03-20T10:00:00+09:00'))
B契約.deliver(
    '雇用契約書.md',
    '雇用契約書',
    '2025-07-01',
    'B商店 店主 鈴木様',
    '有期契約への変更',
    ['docDocx', 'cmpPdf'],
    '事務員B',
    new Date('2025-06-20T16:00:00+09:00'),
)
C契約.deliver(
    '業務委託契約書.md',
    '業務委託契約書',
    '2024-04-01',
    'C法律事務所 事務局',
    '',
    ['docPdf', 'docDocx'],
    '山田',
    new Date('2024-03-25T14:00:00+09:00'),
)
C契約.deliver(
    '業務委託契約書.md',
    '業務委託契約書',
    '2025-04-01',
    'C法律事務所 事務局',
    '更新分',
    ['docPdf', 'cmpPdf'],
    '山田',
    new Date('2025-03-25T14:00:00+09:00'),
    '施行/業務委託契約書/2024-04-01',
)
D規程.deliver('旅費規程.md', '旅費規程', '2025-10-01', '合同会社D 総務 佐藤様', '新設', ['docPdf', 'docDocx'], '事務員A', new Date('2025-09-25T13:00:00+09:00'))
D規程.deliver(
    '旅費規程.md',
    '旅費規程',
    '2026-04-01',
    '合同会社D 総務 佐藤様',
    '宿泊料の改定',
    ['docPdf', 'cmpPdf', 'cmpDocx'],
    '山田',
    new Date('2026-03-18T13:00:00+09:00'),
    '施行/旅費規程/2025-10-01',
)
D規程.deliver(
    '就業規則.md',
    '就業規則',
    '2026-04-01',
    '合同会社D 総務 佐藤様',
    '始業・終業時刻の変更',
    ['docPdf', 'docDocx', 'cmpPdf', 'opinion'],
    '山田',
    new Date('2026-03-18T13:30:00+09:00'),
    '施行/就業規則/2024-05-01',
)

tick(0, 1)
for (const r of repos) r.writeRecords()

console.log(JSON.stringify(Object.fromEntries(repos.map((r) => [r.name, r.summary()])), null, 2))
