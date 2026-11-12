import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { join } from 'node:path'
import { checkDefinitions, findDefinitions } from '../src/shared/definitions'
import { checkDoc } from '../src/shared/doc-view'

const msgs = (src: string) => checkDefinitions(src).map((i) => `${i.line}:${i.message}`)

describe('定義語のチェック', () => {
    it('「以下「X」という。」と「「X」とは、」の定義を拾う。括弧の中の複数の語も', () => {
        const src =
            '# 契約\n\n- 株式会社A（以下「甲」という。）と株式会社B（以下「乙」という。）は、次のとおり契約（以下「本契約」という。）を結ぶ。\n- この契約において「成果物」とは、乙が納める物をいう。\n- 甲及び乙（以下「当事者」又は「両者」と総称する。）\n'
        expect(findDefinitions(src).map((d) => [d.term, d.kind])).toEqual([
            ['甲', 'hereinafter'],
            ['乙', 'hereinafter'],
            ['本契約', 'hereinafter'],
            ['成果物', 'means'],
            ['当事者', 'hereinafter'],
            ['両者', 'hereinafter'],
        ])
    })

    it('二重定義・定義より前の使用・未使用を指摘する', () => {
        const src = [
            '# 業務委託契約書',
            '',
            '### 目的',
            '- 委託者は、受託者に業務を委託する。',
            '- 株式会社A（以下「委託者」という。）は、株式会社B（以下「受託者」という。）に委託する。',
            '- 委託料（以下「対価」という。）は別に定める。',
            '- 株式会社A（以下「委託者」という。）は、受託者に支払う。',
        ].join('\n')
        expect(msgs(src)).toEqual([
            '4:「委託者」は5行目で定義しています。定義より前で使っています',
            '4:「受託者」は5行目で定義しています。定義より前で使っています',
            '6:「対価」を定義していますが、使っていません',
            '7:「委託者」は5行目ですでに定義しています',
        ])
    })

    it('複合語の一部・定義している文の中・題名・見出し・設定や参照は数えない', () => {
        const src = [
            '# 就業規則',
            '<!-- clausedown',
            'article: { title: inline }',
            '-->',
            '### 規則の目的 {#規則}',
            '- この就業規則（以下「規則」という。）は、[[規則]]により定める。',
            '- 規則は全員に適用する。',
        ].join('\n')
        expect(msgs(src)).toEqual([])
    })

    it('「とは」で定義した語は、定義より前で使っても指摘しない（法令の目的規定など）', () => {
        const src = '# 法\n### 目的\n- この法律は、消費者の利益を守る。\n### 定義\n- この法律において「消費者」とは、個人をいう。\n'
        expect(msgs(src)).toEqual([])
    })

    it('「以下この項において」のように範囲を限った定義は対象にしない。附則はそれぞれ別に扱う', () => {
        const scoped = '# 法\n- 物の分量（以下この項において「分量等」という。）を定める。\n'
        expect(findDefinitions(scoped)).toEqual([])
        const supp =
            '# 法\n### 目的\n- 定める。\n## 附則 {supplement}\n- 旧法（以下「新法」という。）の新法による。\n## 附則 {supplement}\n- 別の法（以下「新法」という。）の新法による。\n'
        expect(msgs(supp)).toEqual([])
    })

    it('長い定義語の中の短い定義語は数えない', () => {
        const src = '# 契約\n- 開発（以下「業務」という。）のうち保守（以下「本件業務」という。）は、本件業務として扱う。\n'
        expect(msgs(src)).toEqual(['2:「業務」を定義していますが、使っていません'])
    })

    it('見本の契約書・就業規則・条例では指摘が出ない', () => {
        for (const f of [
            '契約書/業務委託契約書.md',
            '契約書/著作権譲渡契約書.md',
            '社内規程/就業規則.md',
            '条例・要綱/見本市空き家等の適正管理に関する条例.md',
        ]) {
            expect(checkDefinitions(fs.readFileSync(join('example_repository', f), 'utf8')), f).toEqual([])
        }
    })

    it('書き方のチェック（AI・MCP）にも出る', () => {
        const issues = checkDoc('# 契約\n- A（以下「甲」という。）\n')
        expect(issues).toContainEqual({ line: 2, severity: 'error', message: '定義語：「甲」を定義していますが、使っていません' })
    })
})
