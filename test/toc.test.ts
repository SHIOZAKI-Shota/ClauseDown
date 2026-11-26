import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { docToDocx } from '../src/shared/docx-export'
import { titleEndLine, tocEntries, tocPagesFrom } from '../src/shared/toc'
import { toHouritsu } from '../src/shared/houritsu'
import { docTemplates } from '../src/shared/doc-templates'
import { checkDoc } from '../src/shared/doc-view'
import { DEFAULT_STYLE } from '../src/shared/prefs'

const SRC = `# 就業規則

::: cover
{right}
社外秘

{center size=26pt}
就業規則

::: {center}
2026年4月1日 制定
:::
:::

[[_TOC_]]

この規則は、従業員の就業に関する事項を定める。

## 総則

### 目的

本文。

### 定義 {#def}

本文。

### {deleted}

## 附則 {supplement}

- この規則は、2026年4月1日から施行する。

## 別表第一 {appendix}

| 区分 | 内容 |
|---|---|
| A | B |
`

describe('表紙と目次の読み取り', () => {
	it('前文の位置の表紙と目次を取り出し、前文から除く', () => {
		const doc = parseLegal(SRC)
		expect(doc.warnings).toEqual([])
		expect(doc.cover?.line).toBe(2)
		expect(doc.cover?.end).toBe(12)
		expect(doc.cover?.parts.map((p) => p.md)).toEqual(['社外秘', '就業規則', '2026年4月1日 制定'])
		expect(doc.cover?.parts.map((p) => p.props?.textAlign)).toEqual(['right', 'center', 'center'])
		expect(doc.cover?.parts[1].props?.fontSize).toBe('26pt')
		expect(doc.toc?.line).toBe(14)
		expect(doc.preamble).toBe('この規則は、従業員の就業に関する事項を定める。')
		expect(doc.preambleParts?.[0]).toEqual({ md: '', toc: true })
	})

	it('目次の行は条参照の誤りにしない', () => {
		expect(checkDoc(SRC).filter((i) => i.severity === 'error')).toEqual([])
		expect(checkDoc('# 題\n\n## 総則\n\n### 目的\n\n[[_TOC_]]\n').some((i) => i.severity === 'error')).toBe(true)
	})

	it('[TOC] も目次として読む', () => {
		expect(parseLegal('# 題\n\n[TOC]\n\n## 総則\n\n### 目的\n\n本文。\n').toc?.line).toBe(2)
	})

	it('2 つ目・前文の外・閉じていない表紙は警告する', () => {
		const twice = parseLegal('# 題\n\n[[_TOC_]]\n\n[[_TOC_]]\n\n::: cover\nA\n:::\n\n::: cover\nB\n:::\n\n## 総則\n')
		expect(twice.warnings).toEqual(['5行目: 目次（[[_TOC_]]）は 1 つしか書けません', '11行目: 表紙（::: cover）は 1 つしか書けません'])
		expect(twice.cover?.parts.map((p) => p.md)).toEqual(['A'])
		const outside = parseLegal('# 題\n\n## 総則\n\n### 目的\n\n[[_TOC_]]\n\n::: cover\nA\n:::\n')
		expect(outside.toc).toBeUndefined()
		expect(outside.cover).toBeUndefined()
		expect(outside.warnings).toEqual([
			'7行目: 目次（[[_TOC_]]）は題名と最初の章の間に書いてください',
			'9行目: 表紙（::: cover）は題名と最初の章の間に書いてください',
		])
		expect(parseLegal('# 題\n\n::: cover\nA\n\n## 総則\n').warnings).toEqual(['3行目: 表紙（::: cover）を閉じる ::: がありません'])
	})

	it('コードの囲みの中の記号は読まない', () => {
		const doc = parseLegal('# 題\n\n```\n[[_TOC_]]\n::: cover\n```\n\n## 総則\n')
		expect(doc.toc).toBeUndefined()
		expect(doc.cover).toBeUndefined()
		expect(doc.warnings).toEqual([])
	})

	it('houritsu の書き出しには表紙と目次を出さない', () => {
		const out = toHouritsu(SRC)
		expect(out).not.toContain('[[_TOC_]]')
		expect(out).not.toContain('社外秘')
	})
})

describe('目次の項目', () => {
	it('章・条・附則・別表を載せ、後文は除く', () => {
		const entries = tocEntries(parseLegal(SRC))
		expect(entries.map((e) => [e.kind, e.text, e.anchor, !!e.deleted])).toEqual([
			['chapter', '第一章　総則', 'toc-c0', false],
			['article', '第1条（目的）', 'toc-a0', false],
			['article', '第2条（定義）', 'art-def', false],
			['article', '第3条', 'toc-a2', true],
			['chapter', '附則', 'toc-c1', false],
			['chapter', '別表第一', 'toc-c2', false],
		])
	})

	it('英文の契約書は Section の書き方にする', () => {
		const doc = parseLegal(
			`# Services Agreement\n\n[[_TOC_]]\n\n## Definitions\n\n### Definitions\n\nIn this Agreement the following terms have the meanings given below and apply throughout the whole of this Agreement and every schedule attached to it.\n\n### Term\n\nThis Agreement starts on the Effective Date and continues until terminated in accordance with its terms by either party giving written notice.\n`,
		)
		expect(doc.styleId).toBe('contract')
		expect(tocEntries(doc).map((e) => e.text)).toEqual(['Article 1 Definitions', 'Section 1. Definitions', 'Section 2. Term'])
		expect(renderDoc(doc)).toContain('<p class="cd-toc-title">Contents</p>')
	})

	it('ページの印から各項目のページを決める', () => {
		const entries = tocEntries(parseLegal(SRC))
		const spots = new Map(entries.map((e, i) => [e.line, { page: Math.floor(i / 2) + 1, y: 700 }]))
		const map = tocPagesFrom(entries, spots)
		expect([...map]).toEqual([
			['c0', 2],
			['a0', 2],
			['a1', 3],
			['a2', 3],
			['c1', 4],
			['c2', 4],
		])
	})

	it('題名と設定の後ろの行を返す', () => {
		expect(titleEndLine('# 題\n\n<!-- clausedown\ndoc: { style: ja }\n-->\n\n## 総則\n')).toBe(4)
		expect(titleEndLine('# 題\n\n## 総則\n')).toBe(0)
		expect(titleEndLine('本文\n')).toBe(-1)
	})

	it('挿入する表紙のひな形は、表紙として読める', () => {
		const src = `# 規程\n\n${docTemplates('ja').cover('規程')}\n## 総則\n`
		const doc = parseLegal(src)
		expect(doc.warnings).toEqual([])
		expect(doc.cover?.parts.map((p) => p.md)).toContain('規程')
	})
})

describe('表紙と目次の描画', () => {
	it('表紙を先頭に、目次を題名の前に出し、条にリンク先を付ける', () => {
		const html = renderDoc(parseLegal(SRC))
		expect(html.indexOf('cd-cover')).toBeLessThan(html.indexOf('cd-toc'))
		expect(html.indexOf('cd-toc')).toBeLessThan(html.indexOf('cd-title'))
		expect(html).toContain('<a href="#toc-a0">')
		expect(html).toContain('id="toc-a0"')
		expect(html).toContain('id="art-def"')
		expect(html).toContain('<h2 class="cd-chapter-title" id="toc-c0"')
		expect(html).not.toContain('第3条</span><span class="cd-toc-leader">')
	})

	it('ページ番号を入れ、表紙と本文を分けて組める', () => {
		const doc = parseLegal(SRC)
		const pages = new Map([['a0', 2]])
		expect(renderDoc(doc, { tocPages: pages })).toContain(
			'<span class="cd-toc-text">第1条（目的）</span><span class="cd-toc-leader"></span><span class="cd-toc-page">2</span>',
		)
		expect(renderDoc(doc, { tocPages: 'placeholder' })).toContain('<span class="cd-toc-page">000</span>')
		const cover = renderDoc(doc, { part: 'cover' })
		expect(cover).toContain('cd-cover')
		expect(cover).not.toContain('cd-title')
		const body = renderDoc(doc, { part: 'body' })
		expect(body).not.toContain('cd-cover')
		expect(body).toContain('cd-toc')
	})

	it('目次のない文書の出力は変わらない', () => {
		const html = renderDoc(parseLegal('# 題\n\n前文。\n\n## 総則\n\n### 目的\n\n本文。\n'))
		expect(html).not.toContain('toc-')
		expect(html).toContain('<section class="cd-preamble"><p>前文。</p>')
	})
})

describe('Word の表紙と目次', () => {
	it('表紙を別のセクションにし、目次にページの参照を入れる', async () => {
		const buf = await docToDocx(parseLegal(SRC), undefined, { ...DEFAULT_STYLE, pageNumbers: true })
		const files = unzipSync(new Uint8Array(buf))
		const xml = strFromU8(files['word/document.xml'])
		expect(xml.match(/<w:sectPr/g)?.length).toBe(2)
		expect(xml).toContain('<w:vAlign w:val="center"/>')
		expect(xml).toContain('PAGEREF toc_a0')
		expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="toc_a0"/)
		expect(xml).toContain('w:name="toc_a0"')
		expect(xml).toContain('w:name="toc_c2"')
		expect(xml).not.toContain('PAGEREF toc_a2')
		expect(xml).toContain('<w:pgNumType w:start="1"/>')
		expect(strFromU8(files['word/settings.xml'])).toContain('<w:updateFields/>')
		const footers = Object.keys(files).filter((f) => /^word\/footer\d+\.xml$/.test(f))
		expect(footers.length).toBe(1)
		expect(strFromU8(files[footers[0]])).toContain('PAGE')
	})

	it('目次も表紙もない文書はセクションが 1 つのまま', async () => {
		const buf = await docToDocx(parseLegal('# 題\n\n## 総則\n\n### 目的\n\n本文。\n'))
		const xml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml'])
		expect(xml.match(/<w:sectPr/g)?.length).toBe(1)
		expect(xml).not.toContain('PAGEREF')
	})
})
