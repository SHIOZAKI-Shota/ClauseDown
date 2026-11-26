import { describe, expect, it } from 'vitest'
import { blankChain, isSectionMarker } from '../src/shared/mdsig-chain'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'
import { toHouritsu } from '../src/shared/houritsu'

const block = (signer: string) =>
	`<!-- md-signature\nv: 0.0.4\nmethod: tofu\nsigner: ${signer}\nts: 2026-11-16T09:00:00Z\nhash: sha256:00\nsig: base64:AAAA\n-->\n`

const CLOSING = '# 契約書\n\n### 目的\n- 本契約は目的を定める。\n\n## 署名欄 {.closing}\n\n甲　見本 太郎\n\n'
const ARTICLE = '# 契約書\n\n### 目的\n- 本契約は目的を定める。\n\n'

describe('署名ブロックの切り離し', () => {
	it('署名欄で終わる文書でも署名ブロックを表示しない', () => {
		const doc = parseLegal(CLOSING + block('a@example.com') + block('b@example.com'))
		expect(doc.signatures).toEqual({ line: 10, count: 2 })
		expect(renderDoc(doc)).not.toContain('md-signature')
		expect(renderDoc(doc)).toContain('見本 太郎')
	})

	it('条で終わる文書でも署名ブロックを表示しない', () => {
		const doc = parseLegal(ARTICLE + block('a@example.com'))
		expect(doc.signatures?.count).toBe(1)
		expect(renderDoc(doc)).not.toContain('md-signature')
	})

	it('行の位置を変えない', () => {
		const src = CLOSING + block('a@example.com')
		const { text } = blankChain(src)
		expect(text.split('\n')).toHaveLength(src.split('\n').length)
		expect(parseLegal(src).chapters.map((c) => c.line)).toEqual(parseLegal(CLOSING).chapters.map((c) => c.line))
	})

	it('本文中のコード例のブロックは本文として扱う', () => {
		const src = ARTICLE + '```\n' + block('a@example.com') + '```\n\n### 期間\n- 一年とする。\n'
		expect(blankChain(src).chain).toBeUndefined()
		expect(parseLegal(src).signatures).toBeUndefined()
	})

	it('署名ブロックの後ろに文があれば、チェーンとして扱わない', () => {
		const src = ARTICLE + block('a@example.com') + '\n追記\n'
		expect(blankChain(src).chain).toBeUndefined()
	})

	it('改行が CRLF でも切り離す', () => {
		const src = (CLOSING + block('a@example.com')).replace(/\n/g, '\r\n')
		expect(parseLegal(src).signatures?.count).toBe(1)
		expect(renderDoc(parseLegal(src))).not.toContain('md-signature')
	})

	it('houritsu の書き出しにも出さない', () => {
		expect(toHouritsu(CLOSING + block('a@example.com'))).not.toContain('md-signature')
	})
})

describe('セクション署名のマーカー', () => {
	it('マーカーを表示しない', () => {
		const src = '# 契約書\n\n### 目的\n- 本契約は目的を定める。\n\n<!-- mdsig:section terms -->\n### 期間\n- 一年とする。\n<!-- /mdsig:section -->\n'
		const html = renderDoc(parseLegal(src))
		expect(html).not.toContain('mdsig:section')
		expect(html).toContain('一年とする。')
	})

	it('マーカーの形を判定する', () => {
		expect(isSectionMarker('<!-- mdsig:section terms -->')).toBe(true)
		expect(isSectionMarker('<!-- /mdsig:section -->\n')).toBe(true)
		expect(isSectionMarker('<!-- clausedown -->')).toBe(false)
	})
})
