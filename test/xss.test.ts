import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parseFragment } from 'parse5'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc, renderCompareTable, renderInlineDiff } from '../src/shared/legal-renderer'
import { compareSources } from '../src/shared/article-diff'
import { rewriteImages, imagePathOf } from '../src/shared/images'

const SAFE_ATTR_NAME = /^[a-zA-Z_][-\w:.]*$/
const BAD_TAGS = new Set([
	'script',
	'iframe',
	'object',
	'embed',
	'link',
	'meta',
	'base',
	'form',
	'input',
	'button',
	'textarea',
	'select',
	'frame',
	'frameset',
	'applet',
	'audio',
	'video',
	'source',
	'track',
	'portal',
	'foreignobject',
	'animate',
	'set',
	'animatetransform',
	'animatemotion',
	'use',
	'handler',
	'listener',
])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'srcset', 'background', 'ping'])

function findings(html: string): string[] {
	const out: string[] = []
	const walk = (node: import('parse5').Node) => {
		if (node.tagName) {
			const tag = node.tagName.toLowerCase()
			if (BAD_TAGS.has(tag)) out.push(`tag <${tag}>`)
			if (tag === 'style') out.push('tag <style>')
			for (const a of node.attrs ?? []) {
				const name = a.name.toLowerCase()
				if (name.startsWith('on')) out.push(`handler ${a.name}=${a.value.slice(0, 40)}`)
				if (!SAFE_ATTR_NAME.test(a.name)) out.push(`odd attr name ${JSON.stringify(a.name)} on <${tag}>`)
				if (URL_ATTRS.has(name)) {
					const v = a.value
						.split('')
						.filter((c) => c.charCodeAt(0) > 32)
						.join('')
						.toLowerCase()
					if (/^(javascript|vbscript|data|file|blob):/.test(v)) out.push(`url ${name}=${a.value.slice(0, 50)}`)
					if ((tag === 'img' || tag === 'image') && /^(https?:)?\/\//.test(v)) out.push(`remote img ${a.value.slice(0, 50)}`)
				}
				if (name === 'style' && /url\s*\(|expression\s*\(|@import|behavior\s*:|position\s*:\s*fixed/i.test(a.value))
					out.push(`style ${a.value.slice(0, 60)}`)
				if (name === 'srcdoc') out.push('srcdoc')
			}
		}
		for (const c of node.childNodes ?? []) walk(c)
		if (node.content) walk(node.content)
	}
	walk(parseFragment(html))
	return [...new Set(out)]
}

const P = [
	`<script>alert(1)</script>`,
	`<img src=x onerror=alert(1)>`,
	`"><img src=x onerror=alert(1)>`,
	`' onmouseover='alert(1)`,
	`" onmouseover="alert(1)`,
	`javascript:alert(1)`,
	`JaVaScRiPt:alert(1)`,
	`java\tscript:alert(1)`,
	`data:text/html,<script>alert(1)</script>`,
	`</style><script>alert(1)</script>`,
	`</title><svg onload=alert(1)>`,
	`&lt;script&gt;alert(1)&lt;/script&gt;`,
	`&#60;script&#62;`,
	`\u0000<svg/onload=alert(1)>`,
	`x" onfocus="alert(1)" autofocus="`,
	`x' onfocus='alert(1)' autofocus='`,
	`]] onmouseover=alert(1) [[`,
	`{#x" onmouseover="alert(1)}`,
	`{font="a onmouseover=alert(1) b"}`,
	`{font=a;background:url(//evil/x)}`,
	`{size=12pt;background:url(//evil)}`,
	`{size="1pt\\"onmouseover=alert(1)"}`,
	`{n=1" onmouseover="alert(1)}`,
	`$\\href{javascript:alert(1)}{x}$`,
	`$\\htmlData{onmouseover=alert(1)}{x}$`,
	`$\\url{javascript:alert(1)}$`,
	`$\\includegraphics{http://evil/x.png}$`,
	`$\\class{x" onmouseover="alert(1)}{y}$`,
	`$\\style{background:url(//evil)}{y}$`,
	`$\\text{<img src=x onerror=alert(1)>}$`,
	`![a](x.png "t\\" onerror=\\"alert(1)")`,
	`![a" onerror="alert(1)](x.png)`,
	`![a](javascript:alert(1))`,
	`![a](http://evil.example/x.png)`,
	`![a](//evil.example/x.png)`,
	`![a](x.png?"onerror="alert(1))`,
	`![a](../../../../etc/passwd.png)`,
	`[a](javascript:alert(1))`,
	`[a](JAVASCRIPT:alert(1))`,
	`[a](vbscript:x)`,
	`[a](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)`,
	`[a](file:///etc/passwd)`,
	`[a](x "t\\" onmouseover=\\"alert(1)")`,
	`[x](u "ti[tle") ]{font="a onmouseover=alert(1) b"}`,
	`[x](u "ti[tle")]{size=12}`,
	`[t[x](u "a")]{size=12}`,
	`[![a](x.png "q[")]{font="z onerror=alert(1) z"}`,
	`<a href="javascript:alert(1)">x</a>`,
	`<details open ontoggle=alert(1)>`,
	`<math><mtext><img src=x onerror=alert(1)></mtext></math>`,
	`<svg><animate onbegin=alert(1) attributeName=x dur=1s>`,
	`<!--><script>alert(1)</script>-->`,
	`<![CDATA[<script>alert(1)</script>]]>`,
	`%3Cscript%3Ealert(1)%3C/script%3E`,
	`‮<script>`,
	`|<img src=x onerror=alert(1)>|`,
	`> | ^ | <svg onload=alert(1)>`,
]

const SLOTS: ((p: string) => string)[] = [
	(p) => `# ${p}\n\n### 目的\n- 本文\n`,
	(p) => `# 題\n\n${p}\n\n## 総則\n### 目的\n- 本文\n`,
	(p) => `# 題\n\n## ${p}\n### 目的\n- 本文\n`,
	(p) => `# 題\n\n## 総則 {${p}}\n### 目的\n- 本文\n`,
	(p) => `# 題\n\n### ${p}\n- 本文\n`,
	(p) => `# 題\n\n### 目的 {#${p}}\n- 本文\n### 次\n- [[${p}]]の規定\n`,
	(p) => `# 題\n\n### 目的 ${p}\n- 本文\n`,
	(p) => `# 題\n\n### 目的\n- ${p}\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  - ${p}\n    - ${p}\n`,
	(p) => `# 題\n\n### 目的\n- [[${p}]]\n`,
	(p) => `# 題\n\n### 目的\n- [${p}]{size=12}\n`,
	(p) => `# 題\n\n### 目的\n- [x]${p}\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  | 区分 | ${p} |\n  |---|---|\n  | ${p} | > |\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  \`\`\`mermaid\n  flowchart LR\n    A[${p}] --> B["${p}"]\n    B -->|${p}| C(${p})\n  \`\`\`\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  \`\`\`mermaid\n  ${p}\n  \`\`\`\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  \`\`\`mermaid ${p}\n  flowchart LR\n    A --> B\n  \`\`\`\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  \`\`\`math\n  ${p}\n  \`\`\`\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n  \`\`\`${p}\n  x\n  \`\`\`\n`,
	(p) => `# 題\n\n### 目的\n- $${p}$\n`,
	(p) => `# 題\n\n### 目的\n- $$${p}$$\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n::: {${p}}\n- 二\n:::\n`,
	(p) => `# 題\n\n### 目的\n{${p}}\n- 本文\n`,
	(p) => `# 題\n<!-- clausedown\nchapter: { numeral: ${p} }\narticle: { numeral: "${p}", title: ${p} }\n-->\n\n### 目的\n- 本文\n`,
	(p) => `# 題\n\n## 附則 {supplement}\n- ${p}\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n\n## {closing}\n${p}\n\n甲　${p}\n`,
	(p) => `# 題\n\n### 目的\n- 本文\n\n## 別表 ${p} {appendix}\n| a | b |\n|---|---|\n| ${p} | ${p} |\n\n${p}\n`,
	(p) => `# 題\n\n### ${p} {n=${p}}\n- 本文\n### {deleted} ${p}\n`,
	(p) => `# 題\n\n### 目的 {branch} {b=${p}}\n- {n=${p}} 本文\n`,
]

function check(label: string, html: string, src: string) {
	const f = findings(html)
	if (f.length) throw new Error(`${label}\n  findings: ${f.join(' | ')}\n  source: ${JSON.stringify(src).slice(0, 300)}\n  html: ${html.slice(0, 600)}`)
}

const failures: string[] = []
function tryCheck(label: string, fn: () => string, src: string) {
	try {
		check(label, fn(), src)
	} catch (e) {
		const m = (e as Error).message
		failures.push(m.includes('  findings: ') ? m : `${m}\n  source: ${JSON.stringify(src).slice(0, 300)}`)
	}
}

const withImg = (html: string, doc = '規程/就業規則.md') =>
	rewriteImages(html, (src) => {
		const path = imagePathOf(doc, src)
		return path ? `app://bundle/__repo/${encodeURIComponent('/repo')}/${path.split('/').map(encodeURIComponent).join('/')}` : null
	})

describe('描画した HTML にスクリプトを混入できない', () => {
	beforeAll(() => {
		vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
	})

	it('文書の各所に攻撃用の文字列を入れても、危険な要素・属性が出ない', () => {
		failures.length = 0
		for (const [si, slot] of SLOTS.entries()) {
			for (const p of P) {
				const src = slot(p)
				tryCheck(`renderDoc slot${si}`, () => withImg(renderDoc(parseLegal(src))), src)
				const base = SLOTS[7]('元の本文')
				tryCheck(`compareTable slot${si}`, () => renderCompareTable(compareSources(base, src), { title: p }), src)
				tryCheck(`inlineDiff slot${si}`, () => renderInlineDiff(compareSources(src, base)), src)
			}
		}
		expect(failures.slice(0, 3)).toEqual([])
	})

	it('海外の書式でも、文書の各所の攻撃用の文字列から危険な要素・属性が出ない', () => {
		failures.length = 0
		for (const style of ['contract', 'us-law', 'uk-law', 'eu', 'de', 'fr', 'decimal']) {
			const head = `<!-- clausedown\ndoc: { style: ${style} }\n-->\n`
			for (const [si, slot] of SLOTS.entries()) {
				for (const p of P) {
					const src = head + slot(p)
					tryCheck(`${style} renderDoc slot${si}`, () => withImg(renderDoc(parseLegal(src))), src)
					const base = head + SLOTS[7]('Original text')
					tryCheck(`${style} compareTable slot${si}`, () => renderCompareTable(compareSources(base, src), { title: p, lang: 'en' }), src)
					tryCheck(`${style} inlineDiff slot${si}`, () => renderInlineDiff(compareSources(src, base), { lang: 'fr' }), src)
				}
			}
		}
		expect(failures.slice(0, 3)).toEqual([])
	})

	it('記号をランダムに並べた入力でも、危険な要素・属性が出ず、例外も出ない', () => {
		failures.length = 0
		const ATOMS = [
			'"',
			"'",
			'<',
			'>',
			'`',
			'[',
			']',
			'{',
			'}',
			'(',
			')',
			'$',
			'\\',
			'|',
			'=',
			' ',
			'\n',
			'\t',
			'&',
			';',
			':',
			'#',
			'!',
			'*',
			'_',
			'~',
			'^',
			'onerror=alert(1)',
			'onmouseover=alert(1)',
			'javascript:',
			'<svg',
			'<img src=x',
			'&quot;',
			'&#39;',
			'&lt;',
			']{',
			'](',
			'[[',
			']]',
			'{#',
			'{font="',
			'{size=',
			'$$',
			'```',
			':::',
			'- ',
			'### ',
			'## ',
			'| ',
			' "t',
			'x.png',
			'http://e/',
			'mermaid',
			'flowchart LR',
			'A[',
			'-->',
			'\\href{',
			'\\text{',
			'a',
			'あ',
		]
		let seed = 12345
		const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed % n)
		for (let i = 0; i < 40000; i++) {
			const n = 3 + rnd(24)
			let s = ''
			for (let k = 0; k < n; k++) s += ATOMS[rnd(ATOMS.length)]
			const slot = SLOTS[rnd(SLOTS.length)]
			const src = slot(s)
			tryCheck('rnd renderDoc', () => withImg(renderDoc(parseLegal(src))), src)
		}
		expect(failures.slice(0, 3)).toEqual([])
	})
})
