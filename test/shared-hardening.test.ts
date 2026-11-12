import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { DEFAULT_CONFIG, readConfig, setConfigValue, writeConfig } from '../src/shared/config'
import { checkDoc, lineLabels, numberedText } from '../src/shared/doc-view'
import { docToDocx } from '../src/shared/docx-export'
import { parseLegal, resolveRefs } from '../src/shared/legal-parser'
import { DEFAULT_STYLE } from '../src/shared/prefs'
import { reviewStatus, type ReviewEvent } from '../src/shared/review'
import { isDate } from '../src/shared/schedule'

const circled = setConfigValue(DEFAULT_CONFIG, 'item.style', 'circled')

describe('writeConfig', () => {
    it('先頭の YAML のコメントやコードブロックの中の「# 」を題名と取り違えない', () => {
        const md = '---\n# YAML のコメント\ntitle: x\n---\n\n```sh\n# コメント\n```\n\n# 題名\n\n### a\n- x\n'
        const out = writeConfig(md, circled)
        expect(out).toBe(md.replace('# 題名\n', '# 題名\n<!-- clausedown\nitem: { style: circled }\n-->\n'))
        expect(parseLegal(out).config.item.style).toBe('circled')
    })

    it('題名がなく先頭に YAML があるときは YAML の後ろに入れる', () => {
        const md = '---\ntitle: x\n---\n\n### a\n- x\n'
        const out = writeConfig(md, circled)
        expect(out.startsWith('---\ntitle: x\n---\n<!-- clausedown\n')).toBe(true)
        expect(parseLegal(out).config.item.style).toBe('circled')
    })

    it('CRLF の文書には CRLF で書く', () => {
        const out = writeConfig('# t\r\n\r\n### a\r\n- x\r\n', circled)
        expect(out).toBe('# t\r\n<!-- clausedown\r\nitem: { style: circled }\r\n-->\r\n\r\n### a\r\n- x\r\n')
    })

    it('引用符付きの "false" も真偽値として読む', () => {
        const r = readConfig('# t\n<!-- clausedown\nparagraph: { firstNumbered: "false" }\n-->')
        expect(r.config.paragraph.firstNumbered).toBe(false)
        expect(readConfig('# t\n<!-- clausedown\nparagraph: { firstNumbered: "true" }\n-->').config.paragraph.firstNumbered).toBe(true)
    })
})

describe('legal-parser', () => {
    it('[[constructor]] などは条参照にならない', () => {
        const doc = parseLegal('# t\n### 目的\n- [[constructor]]と[[toString]]\n')
        expect(resolveRefs('[[constructor]]', doc)).toBe('[[constructor]]')
        expect(checkDoc('# t\n### 目的\n- [[constructor]]による。\n').map((i) => i.message)).toEqual([expect.stringContaining('[[constructor]]')])
    })

    it('項にも {n=…}{b=…} で番号を指定できる', () => {
        const doc = parseLegal('# t\n### 目的\n- 一項\n- {b=2} 枝の項\n- {n=5} 五項\n')
        const ps = doc.chapters[0].articles[0].paragraphs
        expect(ps.map((p) => p.label)).toEqual(['', '１の２', '５'])
        expect(ps.map((p) => p.text)).toEqual(['一項', '枝の項', '五項'])
        expect([...lineLabels(doc).values()]).toEqual(['第1条', '第1条第1項', '第1条第1項の2', '第1条第5項'])
    })
})

describe('doc-view', () => {
    it('号は番号と枝番号から、項は条番号の書き方で示す', () => {
        const src = '# t\n<!-- clausedown\narticle: { numeral: kanji }\n-->\n### 目的\n- 本文\n- 二項\n  - 甲\n  - {b=2} 乙\n'
        const labels = [...lineLabels(parseLegal(src)).values()]
        expect(labels).toEqual(['第一条', '第一条第一項', '第一条第二項', '第一条第二項第一号', '第一条第二項第一号の二'])
        const c = parseLegal(writeConfig('# t\n### 目的\n- 本文\n  - 甲\n', circled))
        expect([...lineLabels(c).values()]).toContain('第1条第1項第1号')
    })

    it('CRLF の文書でも図の誤りと行番号を正しく出す', () => {
        const src = '# t\r\n\r\n### 目的\r\n- 本文\r\n\r\n  ```mermaid\r\n  flowchart TD\r\n  A -->\r\n  ```\r\n- [[ない]]\r\n'
        const issues = checkDoc(src)
        expect(issues.map((i) => [i.line, i.severity])).toEqual([
            [6, 'warning'],
            [10, 'error'],
        ])
        expect(numberedText(src).split('\n')[2]).toBe(' 3| 〔第1条〕### 目的')
    })

    it('長い文書でも参照の行番号を速く求める', () => {
        const src = '# t\n' + Array.from({ length: 5000 }, (_, i) => `### 条${i}\n- [[ない${i}]]`).join('\n')
        const t = performance.now()
        const issues = checkDoc(src)
        expect(performance.now() - t).toBeLessThan(1000)
        expect(issues.filter((i) => i.severity === 'error').at(-1)!.line).toBe(10001)
    })
})

describe('docx-export', () => {
    const xmlOf = async (src: string, margin: number) =>
        strFromU8(unzipSync(new Uint8Array(await docToDocx(parseLegal(src), undefined, { ...DEFAULT_STYLE, margin })))['word/document.xml'])

    it('表の幅を余白の設定から決める', async () => {
        const src = '# t\n### 目的\n- 本文\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n'
        const narrow = /<w:tblW w:type="dxa" w:w="(\d+)"\/>/.exec(await xmlOf(src, 10))!
        const wide = /<w:tblW w:type="dxa" w:w="(\d+)"\/>/.exec(await xmlOf(src, 30))!
        expect(Number(narrow[1]) - Number(wide[1])).toBe(2 * (Math.round(30 * 56.7) - Math.round(10 * 56.7)))
    })

    it('記号の * や _ は強調のときだけ外し、前文は段落ごとに分ける', async () => {
        const xml = await xmlOf('# t\n\n第一段の*強調*と a_b_c と `x*y`\n続き\n\n第二段\n\n### 目的\n- 2*3\n', 20)
        const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])
        expect(texts).toContain('第一段の強調と a_b_c と x*y続き')
        expect(texts).toContain('第二段')
        expect(texts.some((t) => t.includes('2*3'))).toBe(true)
    })
})

describe('isDate', () => {
    it('存在しない日付を受け付けない', () => {
        expect(isDate('2024-02-29')).toBe(true)
        expect(isDate('2024-02-30')).toBe(false)
        expect(isDate('2023-02-29')).toBe(false)
        expect(isDate('2024-13-01')).toBe(false)
        expect(isDate('2024-1-01')).toBe(false)
    })
})

describe('reviewStatus の並び', () => {
    const ev = (id: string, action: ReviewEvent['action'], by: string, at: string): ReviewEvent => ({ id, branch: 'x', action, oid: 'tip', by, at, text: '' })
    const rules = { requireApproval: true, approvers: [] }

    it('時差の書き方が違っても時刻の順に並べる', () => {
        const s = reviewStatus([ev('1', 'request', 'A', '2026-01-01T01:00:00Z'), ev('2', 'approve', 'B', '2026-01-01T09:30:00+09:00')], 'x', 'tip', rules)
        expect(s.state).toBe('requested')
    })

    it('同じ時刻なら依頼を先にする', () => {
        const s = reviewStatus([ev('2', 'approve', 'B', '2026-01-01T00:00:00Z'), ev('1', 'request', 'A', '2026-01-01T00:00:00.000Z')], 'x', 'tip', rules)
        expect(s.state).toBe('approved')
    })
})
