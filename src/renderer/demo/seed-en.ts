// 英語の画面で見せる見本のデータ。日本語の見本（seed.ts）と同じ組み立て方にそろえる
import { at, buildState, day, edit, insertBefore, removeArticle, Repo } from './seed-kit'
import { DRAFT_PREFIX, MAIN, newId, userFor, type DemoRepo, type DemoState } from './state'

const SOURCES = import.meta.glob('./samples-en/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function source(name: string): string {
    const hit = Object.entries(SOURCES).find(([p]) => p.endsWith(`/samples-en/${name}`))
    if (!hit) throw new Error(`見本の文書 ${name} がありません`)
    return hit[1].replace(/\r\n?/g, '\n')
}

const repo = (dir: string, name: string, note: string) => new Repo(dir, name, note, 'en')

function handbook(): DemoRepo {
    const PATH = 'Employee Handbook.md'
    const latest = source('employee-handbook.md')
    const v3 = edit(latest, 'are granted 5 days of sick leave per year', 'are granted 3 days of sick leave per year')
    const v2 = removeArticle(v3, 'Fertility Treatment Leave')
    const v1 = removeArticle(v2, 'Hourly Paid Leave')

    const HR = 'Emily Chen (HR)'
    const DIRECTOR = 'Robert Hayes (HR Director)'
    const GA = 'Mark Davis (General Affairs)'

    const r = repo(
        '/demo/acme-handbook',
        'Acme Corp. Employee Handbook',
        'Employee representative: Kevin Brooks (Manufacturing). Consult him on every amendment and post the updated Handbook on the intranet.',
    )
    const c1 = r.commit(MAIN, { [PATH]: v1 }, 'Adopt the Employee Handbook', HR, -760)
    r.effective(PATH, day(-730), c1)
    const c2 = r.commit(MAIN, { [PATH]: v2 }, 'Introduce hourly paid leave\n\nCloses #1', HR, -420)
    r.effective(PATH, day(-395), c2)
    const c3 = r.commit(MAIN, { [PATH]: v3 }, 'Add fertility treatment leave', HR, -150)
    r.effective(PATH, day(-120), c3)

    const sideJob = `${DRAFT_PREFIX}Outside-employment-notice`
    const sideText = insertBefore(
        edit(v3, "  - Do not engage in other employment without the Company's permission.\n", ''),
        '### Prohibition of Power Harassment',
        `### Outside Employment
- Employees may work for other businesses outside their working hours.
- An employee who intends to engage in work under the preceding paragraph shall notify the Company in advance using the prescribed form.
- The Company may prohibit or restrict work under the first paragraph if it interferes with the employee's duties, risks the disclosure of trade secrets, or otherwise harms the Company's interests.`,
    )
    r.commit(sideJob, { [PATH]: sideText }, 'Add an article on outside employment', HR, -70, { from: c3 })
    r.review(sideJob, 'request', HR, 'I have added an article on outside employment. The notification form will be set out separately.', -69)
    r.review(sideJob, 'approve', DIRECTOR, 'Looks good. Let us make it effective at the start of the next fiscal year.', -55)

    const c4 = r.commit(MAIN, { [PATH]: latest }, 'Increase sick leave to 5 days\n\nRefs #4', GA, -25)
    r.effective(PATH, day(45), c4)

    const harassment = `${DRAFT_PREFIX}Customer-harassment-policy`
    const k1 = insertBefore(
        latest,
        '### Confidentiality',
        `### Prevention of Customer Harassment
- The Company shall take the measures necessary to protect employees from abusive language, intimidating conduct, unreasonable demands and other seriously disruptive conduct by customers, business partners and other related parties ("Customer Harassment").
- An employee who experiences Customer Harassment shall promptly report it to their supervisor.`,
    )
    r.commit(harassment, { [PATH]: k1 }, 'Add an article on customer harassment\n\nRefs #2', GA, -9, { from: c4 })
    const k2 = edit(
        k1,
        'shall promptly report it to their supervisor.\n',
        'shall promptly report it to their supervisor.\n- The Company shall set up a point of contact for Customer Harassment in the Human Resources Department and shall not treat any employee unfavorably for having sought advice.\n',
    )
    r.commit(harassment, { [PATH]: k2 }, 'Add a point of contact and a ban on retaliation', GA, -4)
    r.review(harassment, 'request', GA, 'New article on customer harassment, in line with the new state guidance. Please take a look.', -4)
    r.review(harassment, 'comment', DIRECTOR, 'Please check with General Affairs whether HR should be the point of contact.', -2)
    r.repo.branchIssues[harassment] = [2]

    r.issue(
        1,
        'Introduce hourly paid leave',
        'Employees have asked to take short absences, such as for medical appointments, without using a full day of leave.',
        DIRECTOR,
        -460,
        {
            comments: [
                [HR, 'We need to decide on the annual limit. Five days per year seems to be the norm.', -455],
                [DIRECTOR, 'Five days per year, please.', -450],
            ],
            closed: { oid: c2, by: HR, offset: -420 },
        },
    )
    r.issue(2, 'Add a customer harassment policy', 'Set out in the Handbook how we respond to seriously disruptive conduct by customers.', GA, -30, {
        comments: [
            [DIRECTOR, 'Please include the duty to report and a point of contact.', -28],
            [GA, 'I have started on this in the draft "Customer-harassment-policy".', -9],
            [HR, 'Whether to add this to the grounds for discipline can be a separate issue.', -3],
        ],
    })
    r.issue(
        3,
        'Move outside employment from approval to notification',
        'We plan to replace the permission requirement with advance notice. We still need to decide how to handle competing work and confidentiality.',
        HR,
        -90,
        {
            comments: [[DIRECTOR, 'The draft is approved. Please set an effective date and merge it into the current version.', -54]],
        },
    )
    r.issue(4, 'Review sick leave and bereavement leave', 'Some employees feel our leave is below the industry standard.', GA, -40, {
        comments: [[GA, 'Sick leave is now 5 days (effective next month). Bereavement leave is still under review.', -25]],
        links: [c4],
    })

    r.event({ kind: 'deadline', title: "Hear the employee representative's views", docPath: PATH, date: day(12), note: 'Kevin Brooks (Manufacturing)' }, HR)
    r.event({ kind: 'notify', title: 'Notify employees of the amendments', docPath: PATH, date: day(30) }, HR)
    r.event({ kind: 'deadline', title: 'Post the updated Handbook', docPath: PATH, date: day(-6), note: 'Intranet and break rooms' }, GA)
    r.event({ kind: 'submit', title: 'Previous amendments sent to the board', docPath: PATH, date: day(-140), done: [day(-140)] }, HR)
    r.event({ kind: 'deadline', title: 'Annual review of the Handbook', docPath: PATH, date: day(-760 + 365 * 2 + 60), repeat: { every: 'year' } }, DIRECTOR)
    return r.repo
}

function services(): DemoRepo {
    const PATH = 'Master Services Agreement.md'
    const latest = source('master-services-agreement.md')
    const v2 = edit(latest, 'continue for three years after', 'continue for two years after')
    const v1 = edit(v2, '$3,000 per month', '$2,500 per month')

    const LEGAL = 'James Wilson (Legal)'
    const GC = 'Karen Lee (General Counsel)'

    const r = repo('/demo/acme-services', 'Acme Corp. Master Services Agreement', 'Counterparty: Bluebird Design Studio LLC (contact: Sarah Miller)')
    r.commit(MAIN, { [PATH]: v1 }, 'Create from the template', LEGAL, -60)
    r.commit(MAIN, { [PATH]: v2 }, "Accept Bluebird's change: fee of $3,000 per month", LEGAL, -48)
    const c3 = r.commit(MAIN, { [PATH]: latest }, 'Extend confidentiality to three years\n\nCloses #1', LEGAL, -40)
    r.effective(PATH, day(-35), c3)

    const redline = `${DRAFT_PREFIX}Bluebird-redline-v2`
    const n1 = edit(
        latest,
        'fails to cure the breach within 30 days after written notice.\n',
        `fails to cure the breach within 30 days after written notice.
- Either Party may terminate this Agreement immediately by written notice, without any cure period, if the other Party:
  - suspends payment of its debts or becomes unable to pay its debts as they fall due;
  - becomes subject to an attachment, garnishment or execution against any of its assets; or
  - files, or has filed against it, a petition in bankruptcy or insolvency.
`,
    )
    r.commit(redline, { [PATH]: n1 }, 'Add termination without cure period (Bluebird redline)', LEGAL, -5, { from: c3 })
    r.review(redline, 'request', LEGAL, 'Bluebird asked to add termination without a cure period.', -5)
    r.review(redline, 'changes', GC, 'Please also let us terminate for breach of anti-bribery and sanctions laws.', -3)
    r.repo.branchIssues[redline] = [2]

    r.issue(1, 'Extend the confidentiality period', 'Two years is too short given when the deliverables will be published.', GC, -50, {
        comments: [[LEGAL, 'Bluebird agreed to three years.', -42]],
        closed: { oid: c3, by: LEGAL, offset: -40 },
    })
    r.issue(
        2,
        'Termination clause (Bluebird request)',
        'Bluebird wants termination without a cure period. We should add anti-bribery language at the same time.',
        LEGAL,
        -6,
        {
            comments: [
                [GC, 'Use the same anti-bribery wording as in our other agreements.', -3],
                [LEGAL, 'Understood. I will fix it in the next version.', -2],
            ],
        },
    )

    r.event({ kind: 'renew', title: 'Deadline to give notice of non-renewal', docPath: PATH, date: day(105), note: 'At least one month before expiry' }, LEGAL)
    r.event({ kind: 'end', title: 'Agreement expires', docPath: PATH, date: day(136) }, LEGAL)
    r.event({ kind: 'deadline', title: 'Send the second redline back to Bluebird', docPath: PATH, date: day(4) }, LEGAL)

    r.repo.deliveries.push({
        id: newId(),
        docPath: PATH,
        title: 'Master Services Agreement',
        client: 'Acme Corp.',
        oid: c3,
        effectiveDate: day(-35),
        to: 'Bluebird Design Studio LLC',
        memo: 'Final version for signature',
        items: ['docPdf', 'docDocx'],
        files: [],
        folder: '',
        at: at(-38),
        by: LEGAL,
    })
    return r.repo
}

function nda(): DemoRepo {
    const PATH = 'Mutual NDA.md'
    const latest = source('mutual-nda.md')
    const v1 = edit(
        edit(latest, 'two years from the date first written above', 'one year from the date first written above'),
        'survive for three years',
        'survive for two years',
    )

    const BD = 'Olivia Brown (Business Development)'
    const LEGAL = 'James Wilson (Legal)'

    const r = repo('/demo/acme-nda', 'Acme Corp. Mutual NDA with Northwind', 'Counterparty: Northwind Traders Ltd. (London office)')
    r.commit(MAIN, { [PATH]: v1 }, 'Draft the NDA', BD, -210)
    const c2 = r.commit(MAIN, { [PATH]: latest }, 'Extend the term to two years and survival to three years', BD, -190)
    r.effective(PATH, day(-185), c2)

    r.issue(
        1,
        'Add a non-solicitation clause?',
        'Our teams will be working closely together. Should we stop each side from hiring the other side’s staff?',
        BD,
        -100,
        {
            comments: [[LEGAL, 'Not needed for an evaluation-stage NDA. Let us raise it in the services agreement instead.', -95]],
        },
    )
    r.event({ kind: 'deadline', title: 'Exchange signed copies', docPath: PATH, date: day(-155), done: [day(-155)] }, BD)
    r.event({ kind: 'end', title: 'NDA term ends', docPath: PATH, date: day(545) }, BD)
    r.event({ kind: 'deadline', title: 'Decide whether to extend the NDA', docPath: PATH, date: day(20) }, BD)
    return r.repo
}

function license(): DemoRepo {
    const PATH = 'Software License Agreement.md'
    const latest = source('software-license-agreement.md')
    const v1 = edit(latest, 'annual license fee of $12,000', 'annual license fee of $10,000')

    const SALES = 'Daniel Kim (Sales)'
    const LEGAL = 'James Wilson (Legal)'

    const r = repo('/demo/acme-license', 'Acme Corp. Software License Agreement', 'Licensee: Riverside Logistics Inc.')
    r.commit(MAIN, { [PATH]: v1 }, 'Create the license agreement', LEGAL, -400)
    const c2 = r.commit(MAIN, { [PATH]: latest }, 'Raise the annual license fee to $12,000\n\nCloses #1', LEGAL, -70)
    r.effective(PATH, day(-60), c2)

    r.issue(1, 'Raise the license fee at renewal', 'The fee has not changed since the first year, while we have added several features.', SALES, -90, {
        comments: [[SALES, 'Riverside accepted $12,000 from the next term.', -72]],
        closed: { oid: c2, by: LEGAL, offset: -70 },
    })
    r.issue(2, 'Spell out support and maintenance', 'Riverside asked what support is included. Consider adding an article or a schedule.', SALES, -12)

    r.event({ kind: 'deadline', title: 'Invoice the annual license fee', docPath: PATH, date: day(15) }, SALES)
    r.event({ kind: 'renew', title: 'Renewal decision', docPath: PATH, date: day(80) }, SALES)
    return r.repo
}

function grants(): DemoRepo {
    const PATH = 'Home Repair Grant Guidelines.md'
    const latest = source('home-repair-grants.md')
    const v1 = edit(edit(latest, 'up to $5,000', 'up to $3,000'), '- The amendments to these Guidelines take effect on October 1, 2026.\n', '')

    const PLANNING = 'Lisa Park (Planning)'
    const FINANCE = 'Daniel Ortiz (Finance)'

    const r = repo(
        '/demo/riverside-grants',
        'Riverside City Home Repair Grant Guidelines',
        'Budget: about 20 grants a year. Applications are accepted at the Planning Department counter.',
    )
    const c1 = r.commit(MAIN, { [PATH]: v1 }, 'Establish the Guidelines', PLANNING, -250)
    r.effective(PATH, '2026-04-01', c1)
    const c2 = r.commit(MAIN, { [PATH]: latest }, 'Raise the grant cap to $5,000\n\nCloses #1', PLANNING, -70)
    r.effective(PATH, '2026-10-01', c2)

    const families = `${DRAFT_PREFIX}Supplement-for-families`
    const k1 = edit(
        latest,
        'up to $5,000.\n',
        'up to $5,000.\n- If the Applicant lives with a child aged 15 or under, the cap under the preceding paragraph is increased by $1,000.\n',
    )
    r.commit(families, { [PATH]: k1 }, 'Add a supplement for families with children', PLANNING, -7, { from: c2 })
    r.review(families, 'request', PLANNING, 'Draft supplement for families with children. Please check the amount against the budget.', -7)
    r.repo.branchIssues[families] = [2]

    r.issue(1, 'Raise the grant cap', 'With rising material costs, $3,000 is not enough to get repairs done.', PLANNING, -100, {
        comments: [[FINANCE, 'The September supplementary budget covers it. Please go with $5,000.', -80]],
        closed: { oid: c2, by: PLANNING, offset: -70 },
    })
    r.issue(2, 'Add a supplement for families with children', 'To encourage families to move to and stay in the City.', PLANNING, -15, {
        comments: [[FINANCE, 'We have costed the supplement at $1,000. Please have it ready for next year’s budget request.', -10]],
    })

    r.event({ kind: 'start', title: 'Grant applications open', docPath: PATH, date: day(-30), end: day(60) }, PLANNING)
    r.event({ kind: 'deadline', title: 'Completion reports due', docPath: PATH, date: day(100) }, PLANNING)
    r.event({ kind: 'deadline', title: 'Submit next year’s budget request', docPath: PATH, date: day(-2) }, PLANNING)
    return r.repo
}

export function seedEn(): DemoState {
    const repos = [services(), handbook(), nda(), license(), grants()]
    const section: Record<string, string> = {
        '/demo/acme-services': 'Acme Corp.',
        '/demo/acme-handbook': 'Acme Corp.',
        '/demo/acme-nda': 'Acme Corp.',
        '/demo/acme-license': 'Acme Corp.',
        '/demo/riverside-grants': 'Riverside City',
    }
    return buildState(repos, section, userFor('en'))
}
