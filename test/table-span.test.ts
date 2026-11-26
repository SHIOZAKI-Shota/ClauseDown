import { describe, expect, it } from 'vitest'
import { readZipEntry } from './helpers'
import { tableSpans } from '../src/shared/table-span'
import { blockLines, renderBlock } from '../src/shared/blocks'
import { parseLegal } from '../src/shared/legal-parser'
import { docToDocx } from '../src/shared/docx-export'

const brief = (grid: string[][]) => tableSpans(grid).map((r) => r.map((s) => (s.hidden ? '-' : `${s.rowspan}x${s.colspan}`)).join(' '))

describe('tableSpans', () => {
	it('> は右のセルと、^ は上のセルと結合する', () => {
		expect(
			brief([
				['区分', '>', '内容'],
				['A', 'B', 'C'],
				['^', 'D', 'E'],
			]),
		).toEqual(['1x1 - 1x2', '2x1 1x1 1x1', '- 1x1 1x1'])
	})

	it('2 行 2 列の結合', () => {
		expect(
			brief([
				['h1', 'h2', 'h3'],
				['>', 'X', 'a'],
				['>', '^', 'b'],
			]),
		).toEqual(['1x1 1x1 1x1', '- 2x2 1x1', '- - 1x1'])
		expect(
			brief([
				['h1', 'h2', 'h3'],
				['>', 'X', 'a'],
				['^', '^', 'b'],
			]),
		).toEqual(['1x1 1x1 1x1', '- 2x2 1x1', '- - 1x1'])
	})

	it('見出しの行をまたぐ ^ と、右端の > は文字として残す', () => {
		expect(
			brief([
				['h1', 'h2'],
				['^', '>'],
			]),
		).toEqual(['1x1 1x1', '1x1 1x1'])
	})
})

const TABLE = ['| 区分 | > | 内容 |', '|---|---|---|', '| 正社員 | 月給 | 無期 |', '| ^ | 時給 | 有期 |'].join('\n')

describe('描画と比べる文', () => {
	it('HTML に colspan と rowspan を付け、結合したセルは出さない', () => {
		const html = renderBlock(TABLE)
		expect(html).toContain('<th colspan="2">内容</th>')
		expect(html).toContain('<td rowspan="2">正社員</td>')
		expect(html).not.toMatch(/<t[dh]>\s*(&gt;|\^)\s*<\/t[dh]>/)
	})

	it('新旧対照表の文には > と ^ を入れない', () => {
		expect(blockLines(TABLE)).toEqual(['［表］', '　区分｜内容', '　正社員｜月給｜無期', '　時給｜有期'])
	})

	it('Word では横の結合と縦の結合にする', async () => {
		const src = ['# 規程', '### 区分', '- 次のとおり。', ...TABLE.split('\n').map((l) => `  ${l}`)].join('\n')
		const xml = readZipEntry(await docToDocx(parseLegal(src)), 'word/document.xml')
		expect(xml).toContain('<w:gridSpan w:val="2"/>')
		expect(xml).toMatch(/<w:vMerge w:val="restart"\/>/)
		expect(xml).toMatch(/<w:vMerge w:val="continue"\/>|<w:vMerge\/>/)
		expect(xml).not.toMatch(/<w:t[^>]*>[>^]<\/w:t>/)
	})
})
