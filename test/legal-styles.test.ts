import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { articleLines, chapterHeading, parseLegal, resolveRefs } from '../src/shared/legal-parser'
import { lineLabels } from '../src/shared/doc-view'
import { renderCompareTable, renderDoc, renderInlineDiff } from '../src/shared/legal-renderer'
import { compareSources } from '../src/shared/article-diff'
import { docToDocx, compareToDocx } from '../src/shared/docx-export'
import { detectLang, resolveStyle, spellLang } from '../src/shared/legal-styles'
import { DEFAULT_CONFIG, readConfig, serializeConfig, setConfigValue } from '../src/shared/config'
import { checkDefinitions, findDefinitions } from '../src/shared/definitions'
import { proofread } from '../src/main/proofread-core'

const withStyle = (style: string, body: string, extra = '') => `# Sample\n\n<!-- clausedown\ndoc: { style: ${style}${extra} }\n-->\n\n${body}`

const BODY = `## Definitions

### Definitions {#def}

- In this Agreement:
  - "Affiliate" means any entity.
    - which controls; or
    - which is controlled.
  - "Business Day" means a weekday.
- Headings are for convenience.

### {#one}

- See [[def:1:1]], [[def:2]], [[def]] and [[def:1:1:2]].

### Old {deleted}

### Extra {branch}

- Text.

## {supplement}

### Effective date

- Effective now.
`

const linesOf = (style: string, extra = '') => {
    const doc = parseLegal(withStyle(style, BODY, extra))
    const arts = doc.chapters.flatMap((c) => c.articles)
    return { doc, arts, text: (i: number) => articleLines(arts[i], doc).join('\n') }
}

describe('系統ごとの番号と参照', () => {
    it('英米の契約書（Section 型）', () => {
        const { doc, arts, text } = linesOf('contract')
        expect(doc.chapters[0].label).toBe('Article 1')
        expect(arts.map((a) => a.label)).toEqual(['Section 1', 'Section 2', 'Section 3', 'Section 3A', 'Section 4'])
        expect(text(0)).toBe(
            [
                'Section 1. Definitions.',
                '1.1 In this Agreement:',
                '    (a) "Affiliate" means any entity.',
                '        (i) which controls; or',
                '        (ii) which is controlled.',
                '    (b) "Business Day" means a weekday.',
                '1.2 Headings are for convenience.',
            ].join('\n'),
        )
        expect(resolveRefs(text(1), doc)).toBe('Section 2. See Section 1.1(a), Section 1.2, Section 1 and Section 1.1(a)(ii).')
        expect(text(2)).toBe('Section 3. [Reserved]')
        expect(text(4)).toBe('Section 4. Effective date. Effective now.')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Transitional Provisions')
    })

    it('英米の契約書の型を選べる', () => {
        expect(linesOf('contract', ', contractType: plain').arts[0].label).toBe('1.')
        const art = linesOf('contract', ', contractType: article')
        expect(art.arts[0].label).toBe('Article 1')
        expect(art.doc.chapters[0].label).toBe('Part 1')
        expect(resolveRefs('[[def:1:1]]', art.doc)).toBe('Article 1.1(a)')
    })

    it('米国の法令', () => {
        const { doc, arts, text } = linesOf('us-law')
        expect(doc.chapters[0].label).toBe('TITLE I')
        expect(arts.map((a) => a.label)).toEqual(['SEC. 1.', 'SEC. 2.', 'SEC. 3.', 'SEC. 3A.', 'SEC. 4.'])
        expect(text(0).split('\n').slice(0, 3)).toEqual(['SEC. 1. DEFINITIONS.', '(a) In this Agreement:', '    (1) "Affiliate" means any entity.'])
        expect(text(0)).toContain('        (A) which controls; or')
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe('section 1(a)(1)(B)')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Effective Date')
    })

    it('英国の法令', () => {
        const { doc, arts, text } = linesOf('uk-law')
        expect(doc.chapters[0].label).toBe('PART 1')
        expect(arts[3].label).toBe('3A')
        expect(text(0).split('\n').slice(0, 3)).toEqual(['1 Definitions', '(1) In this Agreement:', '    (a) "Affiliate" means any entity.'])
        expect(resolveRefs('[[def:1:1]]', doc)).toBe('section 1(1)(a)')
        expect(text(2)).toBe('3 [Repealed]')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Transitional Provisions')
    })

    it('EU の規則は見出しを次の行に置き、参照は逆順', () => {
        const { doc, arts, text } = linesOf('eu')
        expect(doc.chapters[0].label).toBe('CHAPTER I')
        expect(arts[3].label).toBe('Article 3a')
        expect(text(0).split('\n').slice(0, 3)).toEqual(['Article 1', 'Definitions', '1. In this Agreement:'])
        expect(resolveRefs('[[def:1:1]]', doc)).toBe('point (a) of Article 1(1)')
        expect(resolveRefs('[[def:2]]', doc)).toBe('Article 1(2)')
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe('point (a)(ii) of Article 1(1)')
        expect(text(2)).toBe('Article 3 [deleted]')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Final Provisions')
    })

    it('ドイツ', () => {
        const { doc, arts, text } = linesOf('de')
        expect(doc.lang).toBe('de')
        expect(doc.chapters[0].label).toBe('Abschnitt 1')
        expect(arts[3].label).toBe('§ 3a')
        expect(text(0).split('\n').slice(0, 4)).toEqual([
            '§ 1 Definitions',
            '(1) In this Agreement:',
            '    1. "Affiliate" means any entity.',
            '        a) which controls; or',
        ])
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe('§ 1 Absatz 1 Nummer 1 Buchstabe b')
        expect(text(2)).toBe('§ 3 (weggefallen)')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Übergangsvorschriften')
    })

    it('フランスは alinéa に番号を付けず、参照は序数で逆順', () => {
        const { doc, arts, text } = linesOf('fr')
        expect(doc.lang).toBe('fr')
        expect(doc.chapters[0].label).toBe('Chapitre Ier')
        expect(arts.map((a) => a.label)).toEqual(['Article 1er', 'Article 2', 'Article 3', 'Article 3 bis', 'Article 4'])
        expect(text(0).split('\n').slice(0, 4)).toEqual(['Article 1er', 'Definitions', 'In this Agreement:', '    1° "Affiliate" means any entity.'])
        expect(resolveRefs('[[def:1:1]]', doc)).toBe("1° du premier alinéa de l'article 1er")
        expect(resolveRefs('[[def:2]]', doc)).toBe("deuxième alinéa de l'article 1er")
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe("b du 1° du premier alinéa de l'article 1er")
        expect(text(2)).toBe('Article 3 (abrogé)')
    })

    it('社内規程・規格は章の番号を含む十進で、附則は振り直す', () => {
        const { doc, arts, text } = linesOf('decimal')
        expect(doc.chapters[0].label).toBe('1')
        expect(arts.map((a) => a.label)).toEqual(['1.1', '1.2', '1.3', '1.3A', '1'])
        expect(text(0).split('\n').slice(0, 3)).toEqual(['1.1 Definitions', 'In this Agreement:', '    a) "Affiliate" means any entity.'])
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe('1.1 a) 2)')
        expect(chapterHeading(doc.chapters[1], doc)).toBe('Supplementary Provisions')
        const ja = parseLegal(withStyle('decimal', '## 総則\n\n### 目的\n\n- この規程は、目的を定める。\n\n## {supplement}\n\n### 施行\n\n- 施行する。\n'))
        expect(ja.chapters.flatMap((c) => c.articles.map((a) => a.label))).toEqual(['1.1', '1'])
        expect(chapterHeading(ja.chapters[1], ja)).toBe('附則')
        expect(articleLines(ja.chapters[0].articles[0], ja)[0]).toBe('1.1 目的')
    })

    it('日本の参照は今のまま。深い段も書ける', () => {
        const doc = parseLegal('# 規則\n\n### 定義 {#def}\n\n- 次のとおり。\n  - 甲\n    - 乙\n    - 丙\n- 二項\n')
        expect(resolveRefs('[[def:1:1]]', doc)).toBe('第1条第1項第1号')
        expect(resolveRefs('[[def:1:1:2]]', doc)).toBe('第1条第1項第1号ロ')
    })

    it('項が一つなら番号を付けない', () => {
        const doc = parseLegal(withStyle('contract', '### Term\n\n- This Agreement lasts one year.\n'))
        expect(articleLines(doc.chapters[0].articles[0], doc)).toEqual(['Section 1. Term. This Agreement lasts one year.'])
    })

    it('位置の表示は系統の参照の書き方になる', () => {
        const labels = [...lineLabels(linesOf('eu').doc).values()]
        expect(labels).toContain('point (a)(ii) of Article 1(1)')
        expect(labels).toContain('Article 3 [deleted]')
    })
})

describe('自動判定', () => {
    const en = 'The Recipient shall keep all Confidential Information strictly confidential and shall not disclose it to any third party. '.repeat(4)
    const ja = 'この契約は、甲及び乙の間の秘密情報の取扱いについて定めるものとする。'.repeat(8)

    it('和文は日本、英文は英米の契約書', () => {
        expect(resolveStyle(DEFAULT_CONFIG, `# 契約\n\n### 目的\n\n- ${ja}\n`).id).toBe('ja')
        expect(resolveStyle(DEFAULT_CONFIG, `# NDA\n\n### Purpose\n\n- ${en}\n`)).toEqual({ id: 'contract', lang: 'en' })
    })

    it('短い英文は日本のまま', () => {
        expect(resolveStyle(DEFAULT_CONFIG, '# NDA\n\n### Purpose\n\n- The parties agree.\n').id).toBe('ja')
    })

    it('和英併記は多いほう', () => {
        expect(detectLang(`${ja}\n${en.slice(0, 120)}`)).toBe('ja')
        expect(detectLang(`${en}${en}\n${ja.slice(0, 20)}`)).toBe('en')
    })

    it('設定・コード・条参照・URL は数えない', () => {
        const noise = `<!-- clausedown\n${'x'.repeat(500)}\n-->\n\`\`\`\n${'code '.repeat(200)}\n\`\`\`\nhttps://example.com/${'a'.repeat(300)} [[${'b'.repeat(300)}]]`
        expect(detectLang(`${noise}\n${ja}`)).toBe('ja')
    })

    it('ドイツ語・フランス語は英米の契約書になり、明示すれば切り替わる', () => {
        const de =
            'Der Arbeitgeber ist verpflichtet, dem Arbeitnehmer die vereinbarte Vergütung zu zahlen und die gesetzlichen Vorschriften einzuhalten. '.repeat(3)
        expect(resolveStyle(DEFAULT_CONFIG, de).id).toBe('contract')
        expect(parseLegal(withStyle('de', `### Pflichten\n\n- ${de}\n`)).styleId).toBe('de')
    })

    it('明示すると判定より優先する', () => {
        expect(parseLegal(withStyle('ja', `### Purpose\n\n- ${en}\n`)).styleId).toBe('ja')
        expect(parseLegal(withStyle('us-law', `### 目的\n\n- ${ja}\n`)).styleId).toBe('us-law')
    })

    it('つづりの言語は系統に従う', () => {
        expect(spellLang('ja', 'ja')).toBeNull()
        expect(spellLang('contract', 'en')).toBe('en-US')
        expect(spellLang('eu', 'en')).toBe('en-GB')
        expect(spellLang('de', 'de')).toBe('de-DE')
        expect(spellLang('decimal', 'ja')).toBeNull()
    })
})

describe('書式設定', () => {
    it('系統と契約書の型を読み書きでき、既定は書き込まない', () => {
        expect(readConfig('<!-- clausedown\ndoc: { style: eu }\n-->').config.doc.style).toBe('eu')
        expect(readConfig('<!-- clausedown\ndoc: { style: korea }\n-->').warnings[0]).toContain('書式の系統')
        expect(serializeConfig(DEFAULT_CONFIG)).toBe('')
        expect(serializeConfig(setConfigValue(DEFAULT_CONFIG, 'doc.contractType', 'plain'))).toBe('doc: { contractType: plain }')
    })
})

describe('描画と書き出し', () => {
    it('HTML に系統と言語の印を付け、日本は今のまま', () => {
        expect(renderDoc(linesOf('us-law').doc)).toMatch(/^<article class="cd-doc cd-latin cd-style-us-law cd-lang-en" lang="en">/)
        expect(renderDoc(parseLegal('# 規則\n\n### 目的\n\n- 定める。\n'))).toMatch(/^<article class="cd-doc cd-indent-nested">/)
    })

    it('見出しの置き方が系統に従う', () => {
        const html = renderDoc(linesOf('contract').doc)
        expect(html).toContain('<p class="cd-art-head"><span class="cd-num cd-art-label">Section 1.</span> <span class="cd-art-name">Definitions.</span></p>')
        expect(html).toContain('<span class="cd-num cd-art-label">Section 3.</span> [Reserved]')
        expect(renderDoc(linesOf('eu').doc)).toContain(
            '<p class="cd-art-head cd-stacked"><span class="cd-num cd-art-label">Article 1</span></p><p class="cd-art-title">',
        )
    })

    it('比較の文言が言語に従う', () => {
        const rows = compareSources(withStyle('contract', '### A\n\n- old\n'), withStyle('contract', '### A\n\n- new\n\n### B\n\n- added\n'))
        expect(renderCompareTable(rows, { lang: 'en' })).toContain('<th>Revised</th><th>Current</th>')
        expect(renderCompareTable(rows, { lang: 'en' })).toContain('(New)')
        expect(renderCompareTable(rows, { lang: 'de' })).toContain('<th>Neue Fassung</th><th>Bisherige Fassung</th>')
        expect(renderInlineDiff(rows, { lang: 'fr', omitUnchanged: true })).not.toContain('（略）')
        expect(renderCompareTable(rows)).toContain('<th>改正後</th><th>改正前</th>')
    })

    it('Word では番号と本文の間をタブにし、欧文書体を指定する', async () => {
        for (const style of ['contract', 'us-law', 'uk-law', 'eu', 'de', 'fr', 'decimal']) {
            const zip = unzipSync(new Uint8Array(await docToDocx(linesOf(style).doc)))
            const xml = strFromU8(zip['word/document.xml'])
            if (style !== 'fr' && style !== 'decimal') expect(xml, style).toContain('<w:tab/>')
            expect(strFromU8(zip['word/styles.xml']), style).toContain('w:ascii="Times New Roman"')
        }
        const rows = compareSources(withStyle('contract', '### A\n\n- old\n'), withStyle('contract', '### A\n\n- new\n'))
        const xml = strFromU8(unzipSync(new Uint8Array(await compareToDocx(rows, { lang: 'en' })))['word/document.xml'])
        expect(xml).toContain('Revised')
    })
})

describe('英語の定義語', () => {
    const src = `# NDA

This Agreement (the "Agreement") is made by Acme Inc. (the "Discloser") and Beta LLC (each, a "Party" and together, the "Parties").

### Definitions

- “Confidential Information” means any information disclosed.
- "Affiliate" means an entity.

### Duties

- Each Party's obligations under this Agreement survive. Confidential Information is secret. The Discloser's rights are reserved.
- The Recipient (the "Agreement") agrees. See "Schedule 1".
- An agreement in lower case does not count, nor does Affiliated.
`

    it('括弧の定義・means の定義・曲がった引用符を拾う', () => {
        expect(findDefinitions(src).map((d) => `${d.kind}:${d.term}`)).toEqual([
            'hereinafter:Agreement',
            'hereinafter:Discloser',
            'hereinafter:Party',
            'hereinafter:Parties',
            'means:Confidential Information',
            'means:Affiliate',
            'hereinafter:Agreement',
        ])
    })

    it('二重定義・未使用を指摘し、所有格・複数形は使用とみなす。大文字小文字と語の区切りを区別する', () => {
        const issues = checkDefinitions(src).map((d) => d.message)
        expect(issues).toContain('「Agreement」は3行目ですでに定義しています')
        expect(issues).toContain('「Affiliate」を定義していますが、使っていません')
        expect(issues.some((m) => m.includes('Party'))).toBe(false)
        expect(issues.some((m) => m.includes('Discloser'))).toBe(false)
    })

    it('定義より前の使用を指摘する', () => {
        const before = '# NDA\n\nThe Supplier shall deliver.\n\nAcme Corp. (the "Supplier") agrees. The Supplier is bound.\n'
        expect(checkDefinitions(before).map((d) => d.message)).toEqual(['「Supplier」は5行目で定義しています。定義より前で使っています'])
    })

    it('複数形の -ies も使用とみなす', () => {
        const ies = '# NDA\n\nAcme (a "Company") agrees. All Companies are bound.\n'
        expect(checkDefinitions(ies)).toEqual([])
    })
})

describe('英文契約の言い回し', () => {
    it('英文で指摘し、言い換えを示す', async () => {
        const src =
            '# NDA\n\n### Term\n\n- In the event that the Buyer pays prior to delivery, the Seller and/or its agents shall be entitled to keep it herein.\n'
        const issues = (await proofread(src)).filter((i) => i.rule === '英文契約の言い回し')
        expect(issues.map((i) => src.slice(i.from, i.to))).toEqual(['In the event that', 'prior to', 'and/or', 'shall be entitled to', 'herein'])
        expect(issues[0].message).toContain('if')
    }, 60_000)

    it('including の書き方の混在を指摘する', async () => {
        const src =
            '# NDA\n\n### A\n\n- Costs, including but not limited to fees.\n- Taxes, including but not limited to VAT.\n- Losses, including without limitation damages.\n'
        const issues = (await proofread(src)).filter((i) => i.rule === '英文契約の言い回し')
        expect(issues.map((i) => src.slice(i.from, i.to))).toEqual(['including without limitation'])
    }, 60_000)

    it('和文には当たらない。切れる', async () => {
        const ja = '# 規則\n\n### 目的\n\n- この規則は、事前に定める。\n'
        expect((await proofread(ja)).filter((i) => i.rule === '英文契約の言い回し')).toEqual([])
        const en = '# NDA\n\n### A\n\n- Pay prior to delivery.\n'
        expect((await proofread(en, { rules: { 'legal-en': false } })).filter((i) => i.rule === '英文契約の言い回し')).toEqual([])
    }, 60_000)
})
