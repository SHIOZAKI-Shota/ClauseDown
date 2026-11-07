import { describe, expect, it } from 'vitest'
import { articleLines, chapterHeading, parseLegal, resolveRefs } from '../src/shared/legal-parser'
import { readConfig, writeConfig, DEFAULT_CONFIG, setConfigValue } from '../src/shared/config'
import { toCircled, toIroha, toKanji, toFullwidth } from '../src/shared/numerals'

describe('numerals', () => {
    it('漢数字', () => {
        expect([1, 10, 11, 20, 21, 100, 110, 999, 2026].map(toKanji)).toEqual([
            '一', '十', '十一', '二十', '二十一', '百', '百十', '九百九十九', '二千二十六',
        ])
    })
    it('全角・丸数字・イロハ', () => {
        expect(toFullwidth(12)).toBe('１２')
        expect([1, 20, 21, 35, 36, 50].map(toCircled)).toEqual(['①', '⑳', '㉑', '㉟', '㊱', '㊿'])
        expect([1, 2, 3, 47, 48].map(toIroha)).toEqual(['イ', 'ロ', 'ハ', 'ス', 'イイ'])
    })
})

const SAMPLE = `# 就業規則

この規則は前文です。

## 総則

### 目的 {#purpose}
- この規則は、従業員の労働条件を定める。
- 前項の規定にかかわらず、別に定める。

### 定義
- この規則で従業員とは、次の者をいう。
  - 正社員
  - 契約社員
    - 有期
    - 無期

## 勤務

### 労働時間 {branch}
- 労働時間は[[purpose]]及び[[purpose:2]]による。

### {deleted}

### 休日
- 休日は日曜とする。

## 附則 {supplement}
- この規則は、令和8年4月1日から施行する。

## {closing}
以上
`

describe('parseLegal（既定の法令式）', () => {
    const doc = parseLegal(SAMPLE)

    it('タイトル・前文・章', () => {
        expect(doc.title).toBe('就業規則')
        expect(doc.preamble).toBe('この規則は前文です。')
        expect(doc.chapters.map(chapterHeading)).toEqual(['第一章　総則', '第二章　勤務', '附則', ''])
        expect(doc.chapters[3].raw.trim()).toBe('以上')
        expect(doc.warnings).toEqual([])
    })

    it('条番号は通し番号、枝番号・削除', () => {
        const labels = doc.chapters.flatMap((c) => c.articles.map((a) => a.label))
        expect(labels).toEqual(['第1条', '第2条', '第3条', '第4条', '第5条'])
    })

    it('枝番号は直前の条に付く', () => {
        const d = parseLegal('# t\n### 甲\n- a\n### 乙 {branch}\n- b\n### 丙 {branch}\n- c\n### 丁\n- d\n')
        expect(d.chapters[0].articles.map((a) => a.label)).toEqual(['第1条', '第1条の2', '第1条の3', '第2条'])
    })

    it('項・号・号の細分', () => {
        const lines = articleLines(doc.chapters[0].articles[1], doc)
        expect(lines).toEqual([
            '（定義）',
            '第2条　この規則で従業員とは、次の者をいう。',
            '　　一　正社員',
            '　　二　契約社員',
            '　　　イ　有期',
            '　　　ロ　無期',
        ])
        expect(articleLines(doc.chapters[0].articles[0], doc)[2]).toBe('　２　前項の規定にかかわらず、別に定める。')
    })

    it('条参照と削除', () => {
        const [a3, a4] = doc.chapters[1].articles
        expect(resolveRefs(a3.paragraphs[0].text, doc)).toBe('労働時間は第1条及び第1条第2項による。')
        expect(articleLines(a4, doc)).toEqual(['第4条　削除'])
    })

    it('附則は条を立てなければ項だけ。1項のみなら番号なし', () => {
        const sup = doc.chapters[2]
        expect(sup.intro[0].label).toBe('')
        const d = parseLegal('# t\n## 附則 {supplement}\n- 施行する。\n- 廃止する。\n')
        expect(d.chapters[0].intro.map((p) => p.label)).toEqual(['１', '２'])
    })
})

describe('設定の切り替え', () => {
    it('契約書式（条見出しを右・第1項に番号・号は（1））', () => {
        const src = `# 業務委託契約書
<!-- clausedown
article: { numeral: arabic, title: inline }
paragraph: { firstNumbered: true, numeral: arabic }
item: { style: paren }
-->
### 目的
- 本契約は、業務の委託について定める。
  - 業務A
- 甲は乙に委託する。
`
        const doc = parseLegal(src)
        expect(doc.warnings).toEqual([])
        expect(articleLines(doc.chapters[0].articles[0], doc)).toEqual([
            '第1条（目的）',
            '　1　本契約は、業務の委託について定める。',
            '　　（1）　業務A',
            '　2　甲は乙に委託する。',
        ])
    })

    it('項の位置を「条と同じ（法令式）」にすると、項を条と同じ位置に置く', () => {
        const src = `# t
<!-- clausedown
paragraph: { indent: flush }
-->
### 目的
- 本文
- 第2項
  - 号
`
        const doc = parseLegal(src)
        expect(articleLines(doc.chapters[0].articles[0], doc)).toEqual(['（目的）', '第1条　本文', '２　第2項', '　一　号'])
    })

    it('漢数字の条番号、章ごとに振り直し', () => {
        const src = `# t
<!-- clausedown
article: { numeral: kanji, numbering: perChapter }
-->
## 一
### a
- x
### b {branch}
- y
## 二
### c
- z
`
        const doc = parseLegal(src)
        expect(doc.chapters.flatMap((c) => c.articles.map((a) => a.label))).toEqual(['第一条', '第一条の二', '第一条'])
    })

    it('不正な設定は警告して既定値を使う', () => {
        const r = readConfig('# t\n<!-- clausedown\narticle: { numeral: roman }\nfoo: 1\n-->')
        expect(r.config).toEqual(DEFAULT_CONFIG)
        expect(r.warnings.length).toBe(2)
    })

    it('writeConfig は既定値と違う項目だけ書き、元に戻すとブロックを消す', () => {
        const base = '# t\n\n### a\n- x\n'
        const c = setConfigValue(DEFAULT_CONFIG, 'item.style', 'circled')
        const written = writeConfig(base, c)
        expect(written).toBe('# t\n<!-- clausedown\nitem: { style: circled }\n-->\n\n### a\n- x\n')
        expect(readConfig(written).config.item.style).toBe('circled')
        expect(writeConfig(written, DEFAULT_CONFIG)).toBe(base)
    })
})

describe('先頭の YAML と番号の指定', () => {
    it('先頭の YAML は読み飛ばし、行番号はずらさない', () => {
        const doc = parseLegal('---\nlaw_id: "x"\ntitle: "t"\n---\n\n# 見本\n\n### 目的\n- 本文\n')
        expect(doc.title).toBe('見本')
        expect(doc.chapters).toHaveLength(1)
        expect(doc.chapters[0].articles[0].line).toBe(7)
    })

    it('{n=… b=…} で条の番号を指定でき、続く条はそこから数える', () => {
        const doc = parseLegal('# t\n\n### a {n=10}\n- x\n\n### b\n- x\n\n### c {n=11 b=2}\n- x\n\n### d {.branch}\n- x\n\n### e {n=11 b=5.2}\n- x\n\n### f\n- x\n')
        expect(doc.chapters[0].articles.map((a) => a.label)).toEqual(['第10条', '第11条', '第11条の2', '第11条の3', '第11条の5の2', '第12条'])
    })

    it('号の行頭の {n=… b=…} で号の番号を指定でき、本文からは取り除く', () => {
        const doc = parseLegal('# t\n\n### a\n- 次のとおり。\n  - 甲\n  - {b=2} 甲の二\n  - 乙\n  - {n=5} 戊\n')
        const items = doc.chapters[0].articles[0].paragraphs[0].items
        expect(items.map((i) => [i.label, i.text])).toEqual([
            ['一', '甲'],
            ['一の二', '甲の二'],
            ['二', '乙'],
            ['五', '戊'],
        ])
    })
})
