import { describe, expect, it } from 'vitest'
import { compareSources, collapseUnchanged } from '../src/shared/article-diff'

const OLD = `# 規則
### 目的
- 労働条件を定める。
### 休日
- 休日は日曜とする。
### 退職
- 退職は届出による。
`

describe('compareSources', () => {
    it('条の挿入で番号がずれた条も、見出しで対応付ける', () => {
        const NEW = OLD.replace('### 休日', '### 定義\n- 用語を定める。\n### 休日').replace('日曜', '土曜及び日曜')
        const rows = compareSources(OLD, NEW)
        expect(rows.map((r) => r.status)).toEqual(['same', 'added', 'changed', 'changed'])
        const holiday = rows[2]
        expect(holiday.oldParts.filter((p) => p.changed).map((p) => p.text).join('')).toBe('2')
        expect(holiday.newParts.filter((p) => p.changed).map((p) => p.text).join('')).toBe('3土曜及び')
    })

    it('見出しを変えた条は隣同士で「変更」にする', () => {
        const rows = compareSources(OLD, OLD.replace('### 退職', '### 退職手続'))
        expect(rows.map((r) => r.status)).toEqual(['same', 'same', 'changed'])
    })

    it('削除と（略）', () => {
        const rows = compareSources(OLD, OLD.replace('### 休日\n- 休日は日曜とする。\n', ''))
        expect(rows.map((r) => r.status)).toEqual(['same', 'removed', 'changed'])
        expect(collapseUnchanged(rows).map((r) => r.status)).toEqual(['omitted', 'removed', 'changed'])
    })
})

describe('条を立てない附則', () => {
    it('附則の本文の変更も対照表に出る', () => {
        const a = '# t\n### 目的\n- x\n## 附則 {supplement}\n- 令和7年4月1日から施行する。\n'
        const rows = compareSources(a, a.replace('令和7年', '令和8年'))
        expect(rows.map((r) => r.status)).toEqual(['same', 'changed'])
        expect(rows[1].newParts.filter((p) => p.changed).map((p) => p.text).join('')).toBe('8')
    })
})

describe('大きな変更と無関係な条', () => {
    it('無関係な条は同じ位置にあっても「変更」で組にしない', () => {
        const a = '# t\n### 目的\n- x\n### 休日\n- 休日は日曜とする。\n'
        const b = '# t\n### 目的\n- x\n### 賞与\n- 賞与は年二回支給する。\n'
        expect(compareSources(a, b).map((r) => r.status)).toEqual(['same', 'removed', 'added'])
    })

    it('見出しのない条は番号で対応付ける', () => {
        const a = '# t\n###\n- 甲とする。\n###\n- 乙とする。\n'
        const rows = compareSources(a, a.replace('乙', '丙'))
        expect(rows.map((r) => r.status)).toEqual(['same', 'changed'])
        expect(rows[1].newParts.filter((p) => p.changed).map((p) => p.text).join('')).toBe('丙')
    })

    it('行ごとに比べ、変わった行だけ文字単位で示す', () => {
        const a = '# t\n### 目的\n- 本文\n  - 一号\n  - 二号\n  - 三号\n'
        const rows = compareSources(a, a.replace('二号', '弐号'))
        expect(rows[0].oldParts.filter((p) => p.changed).map((p) => p.text)).toEqual(['二'])
        expect(rows[0].newParts.filter((p) => p.changed).map((p) => p.text)).toEqual(['弐'])
        expect(rows[0].newParts.map((p) => p.text).join('')).toContain('一　一号\n')
    })

    it('別表をまるごと書き換えても時間がかからない', () => {
        const table = (f: (i: number) => string) => Array.from({ length: 300 }, (_, i) => `| ${f(i)} | ${'あ'.repeat(40)}${i} |`).join('\n')
        const a = `# t\n## 別表 {appendix}\n| a | b |\n|---|---|\n${table((i) => `行${i}`)}\n`
        const b = `# t\n## 別表 {appendix}\n| a | b |\n|---|---|\n${table((i) => `列${i * 7}`)}\n`
        const t = performance.now()
        const rows = compareSources(a, b)
        expect(performance.now() - t).toBeLessThan(2000)
        expect(rows.map((r) => r.status)).toEqual(['changed'])
    })

    it('一行がとても長い条も行ごと変更として扱う', () => {
        const a = `# t\n### 目的\n- ${'あ'.repeat(20000)}\n`
        const b = `# t\n### 目的\n- ${'い'.repeat(20000)}\n`
        const t = performance.now()
        const rows = compareSources(a, b)
        expect(performance.now() - t).toBeLessThan(1000)
        expect(rows[0].status).toBe('changed')
        expect(rows[0].newParts.some((p) => p.changed && p.text.length > 20000)).toBe(true)
    })
})

describe('変更箇所の並び（赤・青の表示）', () => {
    it('消した文字・足した文字・変わらない文字を、文書の順に並べる', async () => {
        const { compareSources } = await import('../src/shared/article-diff')
        const rows = compareSources('# t\n\n### 目的\n- 期間は一年とする。\n', '# t\n\n### 目的\n- 期間は二年とする。\n\n### 新しい条\n- 足した。\n')
        const changed = rows.find((r) => r.status === 'changed')!
        expect(changed.inline.map((p) => p.op)).toEqual(['same', 'del', 'add', 'same'])
        expect(changed.inline.filter((p) => p.op === 'del').map((p) => p.text).join('')).toBe('一')
        expect(changed.inline.filter((p) => p.op === 'add').map((p) => p.text).join('')).toBe('二')
        expect(rows.find((r) => r.status === 'added')!.inline).toEqual([{ text: expect.stringContaining('足した。'), op: 'add' }])
    })
})
