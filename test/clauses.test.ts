import { describe, expect, it } from 'vitest'
import { applyClause, clauseInsertLine, defaultChoice, extractClauses, withHeadingId } from '../src/shared/clauses'
import { parseLegal } from '../src/shared/legal-parser'

const LIB = `# 標準条項

### 目的 {#purpose}
- 本契約は、業務の委託について定める。

### 秘密保持 {#secret}
- 甲及び乙は、[[purpose]]の目的のために知った情報を秘密として扱う。
- [[term]]の期間が終わった後も、[[secret:1]]の義務は残る。

### 契約期間 {#term}
- 本契約の期間は、1年とする。

### {deleted}
`

const TARGET = `# 業務委託契約書

## 総則
### 目的
- 本契約は、システム開発の委託について定める。

### 委託料
- 委託料は、月額とする。

## 雑則
### 協議
- 定めのない事項は協議する。
`

describe('条項ライブラリ', () => {
    const clauses = extractClauses(LIB, '標準条項.md', '標準条項')
    const secret = clauses.find((c) => c.title === '秘密保持')!

    it('ライブラリの文書から、削除された条を除いて条を取り出す。自分への参照は対応づけの対象にしない', () => {
        expect(clauses.map((c) => c.title)).toEqual(['目的', '秘密保持', '契約期間'])
        expect(secret.id).toBe('secret')
        expect(secret.body).toBe(
            '### 秘密保持 {#secret}\n- 甲及び乙は、[[purpose]]の目的のために知った情報を秘密として扱う。\n- [[term]]の期間が終わった後も、[[secret:1]]の義務は残る。',
        )
        expect(secret.refs).toEqual([
            { id: 'purpose', title: '目的' },
            { id: 'term', title: '契約期間' },
        ])
    })

    it('見出しが同じ条を初めから選び、なければ文字で残す', () => {
        const t = parseLegal(TARGET)
        expect(defaultChoice({ id: 'purpose', title: '目的' }, t)).toEqual({ kind: 'article', index: 0 })
        expect(defaultChoice({ id: 'term', title: '契約期間' }, t)).toEqual({ kind: 'text' })
    })

    it('選んだ条に名前を付け、参照を書き換える。対応がなければ見出しの文字にする', () => {
        const t = parseLegal(TARGET)
        const lines = TARGET.split('\n')
        const r = applyClause(secret, t, lines, { purpose: { kind: 'article', index: 0 }, term: { kind: 'text' } })
        expect(r.lineEdits).toEqual([{ line: 3, text: '### 目的 {#purpose}' }])
        expect(r.block).toBe(
            '### 秘密保持 {#secret}\n- 甲及び乙は、[[purpose]]の目的のために知った情報を秘密として扱う。\n- 契約期間の条の期間が終わった後も、[[secret:1]]の義務は残る。',
        )
    })

    it('入れる先に同じ名前があれば付け替え、自分への参照も追随する', () => {
        const src = TARGET.replace('### 委託料', '### 委託料 {#secret}')
        const t = parseLegal(src)
        const r = applyClause(secret, t, src.split('\n'), { purpose: { kind: 'keep' }, term: { kind: 'keep' } })
        expect(r.lineEdits).toEqual([])
        expect(r.block).toContain('### 秘密保持 {#secret-2}')
        expect(r.block).toContain('[[secret-2:1]]の義務')
        expect(r.block).toContain('[[purpose]]の目的')
    })

    it('見出しの名前は既存の属性に足す', () => {
        expect(withHeadingId('### 目的', 'p')).toBe('### 目的 {#p}')
        expect(withHeadingId('### 目的 {branch}', 'p')).toBe('### 目的 {#p branch}')
        expect(withHeadingId('### 目的 {}', 'p')).toBe('### 目的 {#p}')
    })

    it('カーソルのある条の終わりの後に入れる。章の見出しや前文なら、その行の後', () => {
        const t = parseLegal(TARGET)
        const lines = TARGET.split('\n')
        expect(clauseInsertLine(t, lines, 4)).toBe(4)
        expect(clauseInsertLine(t, lines, 6)).toBe(7)
        expect(clauseInsertLine(t, lines, 9)).toBe(9)
        expect(clauseInsertLine(t, lines, 0)).toBe(0)
    })
})
