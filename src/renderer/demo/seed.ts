import type { IssueComment } from '@shared/api'
import { DEFAULT_PREFS } from '@shared/prefs'
import type { ReviewAction } from '@shared/review'
import { DEFAULT_KINDS, type DueEvent } from '@shared/schedule'
import { DRAFT_PREFIX, effectiveTag, MAIN, newId, newOid, USER, type DemoIssue, type DemoRepo, type DemoState } from './state'

export const STATE_VERSION = 2

const SOURCES = import.meta.glob('../../../example_repository/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function source(path: string): string {
    const hit = Object.entries(SOURCES).find(([p]) => p.endsWith(`example_repository/${path}`))
    if (!hit) throw new Error(`見本の文書 ${path} がありません`)
    return hit[1].replace(/\r\n?/g, '\n')
}

function edit(text: string, from: string, to: string): string {
    if (!text.includes(from)) throw new Error(`見本の文書に「${from.slice(0, 30)}」がありません`)
    return text.replace(from, to)
}

function removeArticle(text: string, heading: string): string {
    const start = text.indexOf(`### ${heading}`)
    if (start < 0) throw new Error(`見本の文書に「${heading}」の条がありません`)
    const rest = text.slice(start + 1)
    const next = rest.search(/\n#{2,3} /)
    return text.slice(0, start) + (next < 0 ? '' : rest.slice(next + 1))
}

function insertBefore(text: string, heading: string, block: string): string {
    const at = text.indexOf(`\n${heading}`)
    if (at < 0) throw new Error(`見本の文書に「${heading}」がありません`)
    return `${text.slice(0, at + 1)}${block.trimEnd()}\n\n${text.slice(at + 1)}`
}

const DAY = 86_400_000
const startOfToday = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}
const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number): string {
    const d = new Date(startOfToday() + offset * DAY)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const at = (offset: number, hour = 10) => new Date(startOfToday() + offset * DAY + hour * 3_600_000).toISOString()
const seconds = (offset: number, hour = 10) => Math.floor((startOfToday() + offset * DAY + hour * 3_600_000) / 1000)

class Repo {
    repo: DemoRepo
    constructor(dir: string, name: string, note = '') {
        this.repo = {
            dir,
            name,
            note,
            commits: {},
            branches: {},
            current: MAIN,
            work: {},
            tags: {},
            kinds: DEFAULT_KINDS.map((k) => ({ ...k })),
            events: [],
            issues: [],
            branchIssues: {},
            reviews: [],
            deliveries: [],
        }
    }

    commit(
        branch: string,
        files: Record<string, string>,
        message: string,
        author: string,
        offset: number,
        opts: { from?: string; hour?: number } = {},
    ): string {
        const parent = this.repo.branches[branch] ?? opts.from
        const oid = newOid()
        this.repo.commits[oid] = { oid, parents: parent ? [parent] : [], message, author, timestamp: seconds(offset, opts.hour ?? 10), files: { ...files } }
        this.repo.branches[branch] = oid
        return oid
    }

    effective(docPath: string, date: string, oid: string) {
        this.repo.tags[effectiveTag(docPath, date)] = oid
    }

    event(e: Partial<DueEvent> & Pick<DueEvent, 'kind' | 'docPath' | 'date'>, by: string) {
        const stamp = at(-30)
        this.repo.events.push({ id: newId(), done: [], by, at: stamp, updatedAt: stamp, ...e })
    }

    issue(
        n: number,
        title: string,
        body: string,
        author: string,
        offset: number,
        opts: { comments?: [string, string, number][]; closed?: { oid: string; by: string; offset: number }; links?: string[] } = {},
    ) {
        const comments: IssueComment[] = (opts.comments ?? []).map(([by, text, o]) => ({ id: newId(), body: text, by, at: at(o, 15), kind: 'user' }))
        const links = (opts.links ?? []).map((oid) => ({ oid, at: at(offset + 1), by: author }))
        for (const l of links) comments.push({ id: newId(), body: '', by: l.by, at: l.at, kind: 'link', oid: l.oid })
        if (opts.closed) comments.push({ id: newId(), body: '', by: opts.closed.by, at: at(opts.closed.offset), kind: 'close', oid: opts.closed.oid })
        comments.sort((a, b) => a.at.localeCompare(b.at))
        const issue: DemoIssue = {
            n,
            title,
            body,
            state: opts.closed ? 'closed' : 'open',
            author,
            createdAt: at(offset, 9),
            closedAt: opts.closed ? at(opts.closed.offset) : undefined,
            closedBy: opts.closed?.oid,
            links,
            source: 'local',
            comments,
        }
        this.repo.issues.push(issue)
    }

    review(branch: string, action: ReviewAction, by: string, text: string, offset: number, oid = this.repo.branches[branch]) {
        this.repo.reviews.push({ id: newId(), branch, action, oid, by, at: at(offset, 16), text, source: 'app' })
    }
}

function shugyo(): DemoRepo {
    const PATH = '就業規則.md'
    const latest = source('社内規程/就業規則.md')
    const v3 = edit(latest, '病気休暇を５日与える', '病気休暇を３日与える')
    const v2 = removeArticle(v3, '不妊治療休暇')
    const v1 = removeArticle(v2, '勤務間インターバル')

    const r = new Repo('/demo/mihon-shugyo', '見本株式会社_就業規則', '従業員代表：製造部 小林さん。改定のたびに意見書をもらい、労基署へ届け出る。')
    const c1 = r.commit(MAIN, { [PATH]: v1 }, '就業規則を制定', '人事部 田中', -760)
    r.effective(PATH, day(-730), c1)
    const c2 = r.commit(MAIN, { [PATH]: v2 }, '勤務間インターバル制度を導入\n\nCloses #1', '人事部 田中', -420)
    r.effective(PATH, day(-395), c2)
    const c3 = r.commit(MAIN, { [PATH]: v3 }, '不妊治療休暇を新設', '人事部 田中', -150)
    r.effective(PATH, day(-120), c3)

    const sideJob = `${DRAFT_PREFIX}副業・兼業の届出制`
    const sideText = insertBefore(
        v3,
        '### 職場のパワーハラスメントの禁止',
        `### 副業・兼業
- 労働者は、勤務時間外において、他の会社等の業務に従事することができる。
- 労働者は、前項の業務に従事しようとするときは、事前に会社に所定の届出を行うものとする。
- 会社は、労務提供上の支障がある場合、企業秘密が漏えいする場合その他会社の利益を害する場合には、前項の業務に従事することを禁止し、又は制限することができる。`,
    )
    r.commit(sideJob, { [PATH]: sideText }, '副業・兼業の条を新設', '人事部 田中', -70, { from: c3 })
    r.review(sideJob, 'request', '人事部 田中', '副業・兼業の条を足しました。届出の様式は別に定める想定です。', -69)
    r.review(sideJob, 'approve', '人事部長 山田', '内容はこれで結構です。施行日は来年度の頭にしましょう。', -55)

    const c4 = r.commit(MAIN, { [PATH]: latest }, '病気休暇を5日に拡充\n\nRefs #4', '総務部 佐藤', -25)
    r.effective(PATH, day(45), c4)

    const kasuhara = `${DRAFT_PREFIX}カスタマーハラスメント対策`
    const k1 = insertBefore(
        latest,
        '### 個人情報保護',
        `### 顧客等からの著しい迷惑行為の防止
- 会社は、顧客、取引先その他の関係者からの暴言、威圧的な言動、不当な要求その他の著しい迷惑行為（以下「カスタマーハラスメント」という。）から労働者を守るため、必要な措置を講ずる。
- 労働者は、カスタマーハラスメントを受けたときは、速やかに所属長に報告しなければならない。`,
    )
    r.commit(kasuhara, { [PATH]: k1 }, 'カスタマーハラスメントの条を新設\n\nRefs #2', '総務部 佐藤', -9, { from: c4 })
    const k2 = edit(
        k1,
        '速やかに所属長に報告しなければならない。\n',
        '速やかに所属長に報告しなければならない。\n- 会社は、カスタマーハラスメントに関する相談窓口を人事部に設け、相談した労働者に対し、相談したことを理由として不利益な取扱いをしない。\n',
    )
    r.commit(kasuhara, { [PATH]: k2 }, '相談窓口と不利益取扱いの禁止を追記', '総務部 佐藤', -4)
    r.review(kasuhara, 'request', '総務部 佐藤', '東京都のカスハラ防止条例に合わせて新設しました。ご確認ください。', -4)
    r.review(kasuhara, 'comment', '人事部長 山田', '相談窓口は人事部でよいか、総務部とも調整してください。', -2)
    r.repo.branchIssues[kasuhara] = [2]

    r.issue(1, '勤務間インターバル制度を導入する', '努力義務だが、長時間労働の対策として導入したい。休息時間は11時間を基本とする。', '人事部長 山田', -460, {
        comments: [
            ['人事部 田中', '11時間に満たない場合の扱い（始業を繰り下げるか、労働したものとみなすか）を決める必要があります。', -455],
            ['人事部長 山田', '労働したものとみなす形でお願いします。', -450],
        ],
        closed: { oid: c2, by: '人事部 田中', offset: -420 },
    })
    r.issue(2, 'カスタマーハラスメント対策の規定を設ける', '顧客からの著しい迷惑行為への対応を、就業規則に明記する。', '総務部 佐藤', -30, {
        comments: [
            ['人事部長 山田', '厚労省のマニュアルも参考に。報告の義務と相談窓口は入れてください。', -28],
            ['総務部 佐藤', '改定案「カスタマーハラスメント対策」で書き始めました。', -9],
            ['人事部 田中', '懲戒の事由に加えるかどうかも、別の課題で検討しましょう。', -3],
        ],
    })
    r.issue(3, '副業・兼業を届出制にするか検討', '許可制から届出制に変える方向。競業や情報漏えいの扱いを決める。', '人事部 田中', -90, {
        comments: [['人事部長 山田', '改定案は承認済みです。施行日を決めて現行版に反映してください。', -54]],
    })
    r.issue(4, '病気休暇・慶弔休暇の日数を見直す', '他社水準と比べて少ないとの声がある。', '総務部 佐藤', -40, {
        comments: [['総務部 佐藤', '病気休暇は5日に拡充しました（施行は来月）。慶弔休暇は継続検討です。', -25]],
        links: [c4],
    })

    r.event({ kind: 'deadline', title: '従業員代表の意見書を受け取る', docPath: PATH, date: day(12), note: '製造部 小林さん' }, '人事部 田中')
    r.event({ kind: 'notify', title: '労働基準監督署へ届け出る', docPath: PATH, date: day(30) }, '人事部 田中')
    r.event({ kind: 'deadline', title: '改定内容を社内に周知する', docPath: PATH, date: day(-6), note: '社内ポータルと休憩室に掲示' }, '総務部 佐藤')
    r.event({ kind: 'submit', title: '前回改定の届出', docPath: PATH, date: day(-140), done: [day(-140)] }, '人事部 田中')
    r.event({ kind: 'deadline', title: '就業規則の定期見直し', docPath: PATH, date: day(-760 + 365 * 2 + 60), repeat: { every: 'year' } }, '人事部長 山田')
    return r.repo
}

function itaku(): DemoRepo {
    const PATH = '業務委託契約書.md'
    const latest = source('契約書/業務委託契約書.md')
    const v2 = edit(latest, '本契約の終了後3年間存続する', '本契約の終了後2年間存続する')
    const v1 = edit(v2, '月額300,000円', '月額250,000円')

    const r = new Repo('/demo/mihon-itaku', '見本株式会社_業務委託契約書', '相手方：見本デザイン事務所（担当 中村様）')
    r.commit(MAIN, { [PATH]: v1 }, 'ひな形から作成', '法務部 鈴木', -60)
    r.commit(MAIN, { [PATH]: v2 }, '先方の修正を反映：委託料を月額300,000円に', '法務部 鈴木', -48)
    const c3 = r.commit(MAIN, { [PATH]: latest }, '秘密保持の存続期間を3年に延長\n\nCloses #1', '法務部 鈴木', -40)
    r.effective(PATH, day(-35), c3)

    const nego = `${DRAFT_PREFIX}先方修正案（第2版）`
    const n1 = edit(
        latest,
        '相当の期間を定めて催告してもなお是正されないときは、本契約を解除することができる。\n',
        `相当の期間を定めて催告してもなお是正されないときは、本契約を解除することができる。
- 甲又は乙は、相手方が次の各号のいずれかに該当したときは、何らの催告を要せず、直ちに本契約を解除することができる。
  - 支払を停止し、又は支払不能となったとき
  - 差押え、仮差押え又は競売の申立てを受けたとき
  - 破産手続開始の申立てがあったとき
`,
    )
    r.commit(nego, { [PATH]: n1 }, '無催告解除の条項を追加（先方案）', '法務部 鈴木', -5, { from: c3 })
    r.review(nego, 'request', '法務部 鈴木', '先方から無催告解除の追加の要望がありました。', -5)
    r.review(nego, 'changes', '法務部長 木村', '甲の側からも解除できるよう、反社会的勢力の排除も入れてください。', -3)
    r.repo.branchIssues[nego] = [2]

    r.issue(1, '秘密保持の存続期間を延ばす', '成果物の公開時期を考えると、2年では短い。', '法務部長 木村', -50, {
        comments: [['法務部 鈴木', '先方とは3年で合意できました。', -42]],
        closed: { oid: c3, by: '法務部 鈴木', offset: -40 },
    })
    r.issue(2, '解除条項の見直し（先方要望）', '先方から無催告解除の追加の要望。反社条項も合わせて入れたい。', '法務部 鈴木', -6, {
        comments: [
            ['法務部長 木村', '反社会的勢力の排除の条を、他の契約書と同じ文言で入れてください。', -3],
            ['法務部 鈴木', '承知しました。次の版で直します。', -2],
        ],
    })

    r.event({ kind: 'renew', title: '更新するかを先方に伝える期限', docPath: PATH, date: day(105), note: '期間満了の1か月前まで' }, '法務部 鈴木')
    r.event({ kind: 'end', title: '契約期間の満了', docPath: PATH, date: day(136) }, '法務部 鈴木')
    r.event({ kind: 'deadline', title: '第2版を先方へ返送', docPath: PATH, date: day(4) }, '法務部 鈴木')

    r.repo.deliveries.push({
        id: newId(),
        docPath: PATH,
        title: '業務委託契約書',
        client: '見本株式会社',
        oid: c3,
        effectiveDate: day(-35),
        to: '見本デザイン事務所',
        memo: '締結用の最終版',
        items: ['docPdf', 'docDocx'],
        files: [],
        folder: '',
        at: at(-38),
        by: '法務部 鈴木',
    })
    return r.repo
}

function chosaku(): DemoRepo {
    const PATH = '著作権譲渡契約書.md'
    const latest = source('契約書/著作権譲渡契約書.md')
    const v1 = edit(edit(latest, '金1,000,000円', '金800,000円'), '30日以内', '60日以内')

    const r = new Repo('/demo/mihon-chosaku', '見本出版株式会社_著作権譲渡契約書', '著作者：見本 花子 先生')
    r.commit(MAIN, { [PATH]: v1 }, '契約書の案を作成', '編集部 森', -210)
    const c2 = r.commit(MAIN, { [PATH]: latest }, '対価を1,000,000円に、支払期限を30日以内に変更', '編集部 森', -190)
    r.effective(PATH, day(-185), c2)

    r.issue(1, '電子書籍化の扱いを明記するか', '著作権法第27条・第28条を含めて譲渡しているので不要とも考えられるが、念のため確認したい。', '編集部 森', -100, {
        comments: [['法務担当 井上', '譲渡の範囲は今の文言で足ります。ただし著作者への報告の条を入れると親切です。', -95]],
    })
    r.event({ kind: 'deadline', title: '対価の支払期限', docPath: PATH, date: day(-155), done: [day(-155)] }, '編集部 森')
    r.event({ kind: 'apply', title: '著作権の移転の登録を申請', docPath: PATH, date: day(20) }, '編集部 森')
    return r.repo
}

function jorei(): DemoRepo {
    const PATH = '見本市空き家等の適正管理に関する条例.md'
    const latest = source('条例・要綱/見本市空き家等の適正管理に関する条例.md')
    const v2 = removeArticle(latest, '空き家バンク')
    const v1 = removeArticle(v2, '市民の協力')

    const r = new Repo('/demo/mihon-jorei', '見本市_空き家等適正管理条例', '所管：都市計画課。改正は法制担当の審査を経て議会へ。')
    r.commit(MAIN, { [PATH]: v1 }, '条例案（素案）', '都市計画課 伊藤', -330)
    r.commit(MAIN, { [PATH]: v2 }, 'パブリックコメントの意見を反映：市民の協力を追加', '都市計画課 伊藤', -290)
    const c3 = r.commit(MAIN, { [PATH]: latest }, '議会提出版：空き家バンクの条を追加', '法制担当 高橋', -260)
    r.effective(PATH, '2026-04-01', c3)

    const order = `${DRAFT_PREFIX}特定空家等への命令と公表`
    const o1 = insertBefore(
        latest,
        '## 活用の促進',
        `### 命令
- 市長は、前条の規定による勧告を受けた者が正当な理由がなくてその勧告に係る措置をとらなかった場合において、特に必要があると認めるときは、その者に対し、相当の猶予期限を付けて、その勧告に係る措置をとることを命ずることができる。

### 公表
- 市長は、前条の規定による命令を受けた者が、正当な理由がなくてその命令に従わないときは、その旨を公表することができる。`,
    )
    r.commit(order, { [PATH]: o1 }, '命令と公表の条を新設\n\nRefs #1', '都市計画課 伊藤', -12, { from: c3 })
    const o2 = edit(
        o1,
        '  - 管理不全空き家等　',
        '  - 特定空家等　そのまま放置すれば倒壊等著しく保安上危険となるおそれのある状態その他著しく不適切な状態にある空き家等をいう。\n  - 管理不全空き家等　',
    )
    r.commit(order, { [PATH]: o2 }, '定義に「特定空家等」を追加\n\nRefs #2', '都市計画課 伊藤', -8)
    r.review(order, 'request', '都市計画課 伊藤', '法制担当の審査をお願いします。次の定例会に提出予定です。', -8)
    r.review(order, 'comment', '法制担当 高橋', '「特定空家等」を定義したので、第九条以下で使い分けを確認してください。', -6)
    r.repo.branchIssues[order] = [1, 2]

    r.issue(1, '勧告に従わない場合の命令・公表の規定を設ける', '空家法の改正に合わせ、命令と公表まで条例で定める。', '都市計画課 伊藤', -40, {
        comments: [
            ['法制担当 高橋', '過料を設けるかどうかは、地方検察庁との協議が必要です。今回は公表までにしましょう。', -35],
            ['都市計画課 伊藤', '了解です。改定案で命令と公表の条を書きました。', -12],
        ],
    })
    r.issue(2, '定義に「特定空家等」を加える', '法の用語とそろえる。', '法制担当 高橋', -20)
    r.issue(3, '附則の施行日の書き方をそろえる', '他の条例は和暦で書いている。', '法制担当 高橋', -15, {
        comments: [['都市計画課 伊藤', '次の改正のときにまとめて直します。', -14]],
    })

    r.event({ kind: 'promulgate', title: '公布', docPath: PATH, date: '2026-03-25' }, '法制担当 高橋')
    r.event({ kind: 'start', title: 'パブリックコメントの募集', docPath: PATH, date: day(3), end: day(33) }, '都市計画課 伊藤')
    r.event({ kind: 'submit', title: '改正案を議会に提出', docPath: PATH, date: day(50) }, '都市計画課 伊藤')
    return r.repo
}

function yoko(): DemoRepo {
    const PATH = '見本市空き家改修費補助金交付要綱.md'
    const latest = source('条例・要綱/見本市空き家改修費補助金交付要綱.md')
    const v1 = edit(edit(latest, '500,000円を限度とする', '300,000円を限度とする'), '- この要綱の改正は、2026年10月1日から施行する。\n', '')

    const r = new Repo('/demo/mihon-yoko', '見本市_空き家改修費補助金交付要綱', '予算：年間 20 件程度。申請は都市計画課の窓口で受け付ける。')
    const c1 = r.commit(MAIN, { [PATH]: v1 }, '要綱を制定', '都市計画課 伊藤', -250)
    r.effective(PATH, '2026-04-01', c1)
    const c2 = r.commit(MAIN, { [PATH]: latest }, '補助の限度額を500,000円に引上げ\n\nCloses #1', '都市計画課 伊藤', -70)
    r.effective(PATH, '2026-10-01', c2)

    const kids = `${DRAFT_PREFIX}子育て世帯への加算`
    const k1 = edit(
        latest,
        '500,000円を限度とする。\n',
        '500,000円を限度とする。\n- 補助対象者が中学生以下の子と同居する世帯である場合は、前項の限度額に100,000円を加算する。\n',
    )
    r.commit(kids, { [PATH]: k1 }, '子育て世帯への加算を追加', '都市計画課 伊藤', -7, { from: c2 })
    r.repo.branchIssues[kids] = [2]

    r.issue(1, '補助の限度額を引き上げる', '資材価格の高騰で、30万円では改修が進まない。', '都市計画課 伊藤', -100, {
        comments: [['財政課 小川', '9月補正で予算を確保できました。50万円でお願いします。', -80]],
        closed: { oid: c2, by: '都市計画課 伊藤', offset: -70 },
    })
    r.issue(2, '子育て世帯に加算を設ける', '移住・定住の促進のため。', '都市計画課 伊藤', -15, {
        comments: [['財政課 小川', '加算額は10万円で試算しています。来年度予算の要求に間に合わせてください。', -10]],
    })

    r.event({ kind: 'start', title: '補助金の申請受付', docPath: PATH, date: day(-30), end: day(60) }, '都市計画課 伊藤')
    r.event({ kind: 'deadline', title: '実績報告の締切', docPath: PATH, date: day(100) }, '都市計画課 伊藤')
    r.event({ kind: 'deadline', title: '来年度予算の要求', docPath: PATH, date: day(-2) }, '都市計画課 伊藤')
    return r.repo
}

export function seed(): DemoState {
    const repos = [shugyo(), itaku(), chosaku(), jorei(), yoko()]
    const section: Record<string, string> = {
        '/demo/mihon-shugyo': '見本株式会社',
        '/demo/mihon-itaku': '見本株式会社',
        '/demo/mihon-chosaku': '見本出版株式会社',
        '/demo/mihon-jorei': '見本市',
        '/demo/mihon-yoko': '見本市',
    }
    const first = repos[0]
    return {
        version: STATE_VERSION,
        repos,
        settings: {
            repos: repos.map((r) => ({ name: r.name, dir: r.dir, section: section[r.dir] })),
            current: first.dir,
            author: { name: USER, email: '' },
            username: '',
            prefs: {
                ...DEFAULT_PREFS,
                syncOnStart: false,
                pushOnSave: false,
                notifyDue: false,
                checkUpdateOnStart: false,
                reopenLastDoc: true,
                lastDoc: { dir: first.dir, path: Object.keys(first.commits[first.branches[MAIN]].files)[0] },
                recentDocs: repos.slice(0, 5).map((r, i) => {
                    const path = Object.keys(r.commits[r.branches[MAIN]].files)[0]
                    return { dir: r.dir, path, title: path.replace(/\.md$/i, ''), at: Date.now() - i * 3_600_000 * 7 }
                }),
            },
        },
    }
}
