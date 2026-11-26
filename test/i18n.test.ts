import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { CONFIG_CHOICES, readConfig } from '../src/shared/config'
import { PROOFREAD_RULES, ruleLabel } from '../src/shared/proofread-rules'
import { STYLE_NAMES } from '../src/shared/legal-styles'
import { STATE_LABEL } from '../src/shared/review'
import { COLOR_LABEL, DEFAULT_KINDS } from '../src/shared/schedule'
import { EXPERIMENTS } from '../src/shared/experiments'
import { AI_PROVIDERS } from '../src/shared/ai-providers'
import { checkDefinitions } from '../src/shared/definitions'
import { checkDoc } from '../src/shared/doc-view'
import { warningLine } from '../src/shared/legal-parser'

describe('共有の文言の切り替え', () => {
	afterEach(() => setLocale('ja'))

	it('既定は日本語', () => {
		expect(CONFIG_CHOICES['doc.style'].label).toBe('書式の系統')
		expect(CONFIG_CHOICES['doc.style'].options.contract).toBe('英米の契約書')
		expect(ruleLabel('prh')).toBe('用字')
		expect(STYLE_NAMES.eu).toBe('EU の規則')
		expect(STATE_LABEL.approved).toBe('承認済み')
	})

	it('英語に切り替えると、読み直したときに英語になる', () => {
		setLocale('en')
		expect(CONFIG_CHOICES['doc.style'].label).toBe('Format system')
		expect(CONFIG_CHOICES['doc.style'].options.contract).toBe('US/UK contract')
		expect(CONFIG_CHOICES['chapter.numeral'].options).toEqual({ kanji: '第一章', arabic: '第1章', fullwidth: '第１章', none: 'No number' })
		expect(Object.keys(CONFIG_CHOICES['paragraph.firstNumbered'].options)).toEqual(['false', 'true'])
		expect(PROOFREAD_RULES.find((r) => r.id === 'no-hankaku-kana')!.label).toBe('Half-width kana')
		expect(STYLE_NAMES.decimal).toBe('Internal rules / standards')
		expect(STATE_LABEL.changes).toBe('Changes requested')
		expect(COLOR_LABEL.slate).toBe('Gray')
		expect(DEFAULT_KINDS[0].label).toBe('Effective')
		expect(EXPERIMENTS[0].label).toBe('Clause library')
		expect(AI_PROVIDERS.ollama.label).toBe('Ollama (local)')
		expect(readConfig('<!-- clausedown\nfoo: { a: 1 }\n-->').warnings).toEqual(['Unknown setting: foo'])
	})

	it('定義語と文書の確認も英語になる', () => {
		const md = '# 契約書\n\n本契約において「甲」とは、売主をいう。\n'
		expect(checkDefinitions(md).map((d) => d.message)).toEqual(['「甲」を定義していますが、使っていません'])
		setLocale('en')
		expect(checkDefinitions(md).map((d) => d.message)).toEqual(['"甲" is defined but never used'])
		expect(checkDoc(md).map((i) => i.message)).toContain('Defined terms: "甲" is defined but never used')
	})

	it('見出しの深さの警告は、どちらの言語でも行番号を読める', () => {
		const md = '# 規程\n\n#### 深すぎる見出し\n'
		expect(checkDoc(md).find((i) => i.message.includes('###'))?.line).toBe(3)
		setLocale('en')
		const issue = checkDoc(md).find((i) => i.message.includes('###'))
		expect(issue?.message).toBe('Line 3: Headings can only go down to ### (article)')
		expect(issue?.line).toBe(3)
		expect(warningLine('12行目: x')).toBe(12)
		expect(warningLine('Line 7: x')).toBe(7)
		expect(warningLine('no line')).toBe(0)
	})
})

// 英語の語順では前に置くので、後ろに付ける語がないもの
const EMPTY_OK = new Set(['root.editor.lint.backrefSuffix'])

describe('辞書の形', () => {
	it('日本語と英語の辞書で、キーと関数の引数の数がそろい、空の文字がない', async () => {
		const { messagesOf } = await import('../src/shared/i18n')
		const problems: string[] = []
		const walk = (a: unknown, b: unknown, path: string) => {
			if (typeof a === 'function') {
				if (typeof b !== 'function' || b.length > a.length) problems.push(`${path}: 関数の形が違う`)
				return
			}
			if (typeof a === 'string') {
				if (typeof b !== 'string' || (a !== '' && b === '' && !EMPTY_OK.has(path))) problems.push(`${path}: 文字がない`)
				return
			}
			if (a && typeof a === 'object') {
				const ka = Object.keys(a).sort()
				const kb = b && typeof b === 'object' ? Object.keys(b).sort() : []
				if (ka.join() !== kb.join()) problems.push(`${path}: キーが違う`)
				for (const k of ka) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)?.[k], `${path}.${k}`)
			}
		}
		walk(messagesOf('ja'), messagesOf('en'), 'root')
		expect(problems).toEqual([])
	})

	it('OS の言語から画面の言語を決める', async () => {
		const { resolveLocale } = await import('../src/shared/i18n')
		expect(resolveLocale('system', ['ja-JP', 'en-US'])).toBe('ja')
		expect(resolveLocale('system', ['en-US'])).toBe('en')
		expect(resolveLocale('system', ['fr-FR', 'ja'])).toBe('en')
		expect(resolveLocale('system', [])).toBe('ja')
		expect(resolveLocale('en', ['ja-JP'])).toBe('en')
		expect(resolveLocale('ja', ['en-US'])).toBe('ja')
	})
})
