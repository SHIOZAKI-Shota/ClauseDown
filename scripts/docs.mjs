import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'out/docs-site'))
const REPO = 'https://github.com/SHIOZAKI-Shota/ClauseDown'
const ORIGIN = 'https://clausedown.app'

const SLUGS = [
	'terms',
	'getting-started',
	'repositories',
	'repository-home',
	'documents',
	'writing',
	'versions',
	'history',
	'comparison',
	'drafts',
	'delivery',
	'issues',
	'due-dates',
	'sharing',
	'houritsu',
	'ai',
	'settings',
	'shortcuts',
	'signatures',
	'experimental',
]

const UI = {
	ja: {
		lang: 'ja',
		docs: 'ドキュメント',
		title: 'ClauseDown ドキュメント',
		top: 'トップ',
		demo: 'デモ',
		download: 'ダウンロード',
		search: 'ドキュメントを検索',
		noHit: '見つかりません',
		onPage: 'このページの内容',
		prev: '前へ',
		next: '次へ',
		chapters: '章の一覧',
		menu: '目次',
		chapter: (n) => `第${n}章`,
		more: (n) => `ほか ${n} 項目`,
		edit: 'GitHub でこのページを直す',
		toDark: 'ダークモードにする',
		toLight: 'ライトモードにする',
		skip: '本文へ移動',
		license: 'MIT ライセンス',
	},
	en: {
		lang: 'en',
		docs: 'Docs',
		title: 'ClauseDown Docs',
		top: 'Home',
		demo: 'Demo',
		download: 'Download',
		search: 'Search the docs',
		noHit: 'No results',
		onPage: 'On this page',
		prev: 'Previous',
		next: 'Next',
		chapters: 'Chapters',
		menu: 'Contents',
		chapter: (n) => `Chapter ${n}`,
		more: (n) => `${n} more`,
		edit: 'Edit this page on GitHub',
		toDark: 'Switch to dark mode',
		toLight: 'Switch to light mode',
		skip: 'Skip to content',
		license: 'MIT License',
	},
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const plain = (html) =>
	html
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')

function slugger() {
	const seen = new Map()
	return (text) => {
		const base = text
			.trim()
			.toLowerCase()
			.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
			.replace(/ /g, '-')
		const n = seen.get(base) ?? 0
		seen.set(base, n + 1)
		return n ? `${base}-${n}` : base
	}
}

function load(lang) {
	const file = path.join(ROOT, lang === 'ja' ? 'docs/manual/README.md' : 'docs/manual/en/README.md')
	const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
	const md = new MarkdownIt({ html: true, linkify: false })
	const tokens = md.parse(src, {})
	const slug = slugger()
	const ids = new Map()
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]
		if (t.type !== 'heading_open') continue
		const text = plain(md.renderInline(tokens[i + 1].content))
		ids.set(t.map[0], { id: slug(text), level: Number(t.tag.slice(1)), text })
	}
	const lines = src.split('\n')
	const chapterStarts = [...ids].filter(([, h]) => h.level === 2 && /^\d+\.\s/.test(h.text)).map(([line, h]) => ({ line, h }))
	const tocLine = [...ids].find(([, h]) => h.level === 2)?.[0] ?? chapterStarts[0].line
	const title = [...ids].find(([, h]) => h.level === 1)?.[1].text ?? 'ClauseDown'
	const intro = lines
		.slice(([...ids].find(([, h]) => h.level === 1)?.[0] ?? -1) + 1, tocLine)
		.join('\n')
		.trim()
	const chapters = chapterStarts.map(({ line, h }, i) => {
		const end = chapterStarts[i + 1]?.line ?? lines.length
		const m = /^(\d+)\.\s+(.*)$/.exec(h.text)
		const num = Number(m[1])
		return { num, slug: SLUGS[num - 1] ?? `chapter-${num}`, title: m[2], id: h.id, start: line + 1, body: lines.slice(line + 1, end).join('\n') }
	})
	const anchors = new Map()
	for (const ch of chapters) {
		anchors.set(ch.id, { slug: ch.slug, id: '' })
		for (const [line, h] of ids)
			if (line > ch.start - 1 && line < ch.start + ch.body.split('\n').length && h.level > 2) anchors.set(h.id, { slug: ch.slug, id: h.id })
	}
	return { lang, md, ids, title, intro, chapters, anchors }
}

function linkFor(href, here, data, depth) {
	if (/^(https?:|mailto:)/.test(href)) return { href, external: true }
	if (href.startsWith('#')) {
		const a = data.anchors.get(decodeURIComponent(href.slice(1)))
		if (!a) return { href }
		if (a.slug === here) return { href: a.id ? `#${a.id}` : '#' }
		return { href: `../${a.slug}/${a.id ? `#${a.id}` : ''}` }
	}
	if (/README\.md(#.*)?$/.test(href)) {
		const other = data.lang === 'ja' ? 'en/' : ''
		return { href: `${'../'.repeat(depth)}${other}` }
	}
	return { href: `${REPO}/blob/master/docs/manual/${data.lang === 'en' ? 'en/' : ''}${href}`, external: true }
}

function renderChapter(ch, data) {
	const { md } = data
	const tokens = md.parse(ch.body, {})
	const depth = data.lang === 'en' ? 2 : 1
	const imgBase = `${'../'.repeat(depth + 1)}docs/manual/${data.lang === 'en' ? 'en/' : ''}`
	const sections = []
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]
		if (t.type === 'heading_open') {
			const h = data.ids.get(t.map[0] + ch.start)
			if (h) {
				t.attrSet('id', h.id)
				if (h.level === 3) sections.push({ id: h.id, text: h.text })
			}
		}
		if (t.type === 'inline' && t.children) {
			for (const c of t.children) {
				if (c.type === 'link_open') {
					const l = linkFor(c.attrGet('href') ?? '', ch.slug, data, depth)
					c.attrSet('href', l.href)
					if (l.external) {
						c.attrSet('target', '_blank')
						c.attrSet('rel', 'noreferrer noopener')
					}
				}
				if (c.type === 'image') {
					const src = c.attrGet('src') ?? ''
					if (!/^https?:/.test(src)) c.attrSet('src', imgBase + src)
					c.attrSet('loading', 'lazy')
				}
			}
		}
	}
	const html = md.renderer
		.render(tokens, md.options, {})
		.replace(/<table>/g, '<div class="table"><table>')
		.replace(/<\/table>/g, '</table></div>')
	return { html, sections }
}

function searchEntries(ch, data, url) {
	const out = []
	const lines = ch.body.split('\n')
	let cur = { title: ch.title, id: '', text: [] }
	const flush = () => {
		const text = plain(data.md.render(cur.text.join('\n')))
			.replace(/\s+/g, ' ')
			.trim()
		out.push({ c: `${ch.num}. ${ch.title}`, t: cur.title, u: `${url}${cur.id ? `#${cur.id}` : ''}`, x: text.slice(0, 1200) })
	}
	lines.forEach((line, i) => {
		const h = data.ids.get(ch.start + i)
		if (h && h.level === 3) {
			flush()
			cur = { title: h.text, id: h.id, text: [] }
			return
		}
		cur.text.push(line)
	})
	flush()
	return out
}

const ICON = {
	globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
	moon: '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
	sun: '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
	search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
	menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
}

function page({ data, ui, slug, title, description, body, sections = [], prev, next, toRoot, otherHref }) {
	const lang = data.lang
	const home = `${toRoot}${lang === 'en' ? '?lang=en' : ''}`
	const docsRoot = `${toRoot}docs/${lang === 'en' ? 'en/' : ''}`
	const canonical = `${ORIGIN}/docs/${lang === 'en' ? 'en/' : ''}${slug ? `${slug}/` : ''}`
	const nav = data.chapters
		.map(
			(c) =>
				`<li><a href="${docsRoot}${c.slug}/"${c.slug === slug ? ' aria-current="page"' : ''}><span class="n">${c.num}</span><span>${esc(c.title)}</span></a></li>`,
		)
		.join('')
	const toc = sections.length
		? `<aside class="toc" aria-label="${esc(ui.onPage)}"><p class="toc-h">${esc(ui.onPage)}</p><ol>${sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.text)}</a></li>`).join('')}</ol></aside>`
		: ''
	const pager =
		prev || next
			? `<nav class="pager" aria-label="${esc(ui.prev)} / ${esc(ui.next)}">${prev ? `<a class="prev" href="${prev.href}"><span>${esc(ui.prev)}</span><b>${esc(prev.title)}</b></a>` : '<span></span>'}${next ? `<a class="next" href="${next.href}"><span>${esc(ui.next)}</span><b>${esc(next.title)}</b></a>` : '<span></span>'}</nav>`
			: ''
	const editPath = `docs/manual/${lang === 'en' ? 'en/' : ''}README.md`
	return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${canonical}" />
<link rel="alternate" hreflang="ja" href="${ORIGIN}/docs/${slug ? `${slug}/` : ''}" />
<link rel="alternate" hreflang="en" href="${ORIGIN}/docs/en/${slug ? `${slug}/` : ''}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="ClauseDown" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${ORIGIN}/og.png" />
<link rel="icon" href="${toRoot}favicon.ico" sizes="any" />
<link rel="icon" href="${toRoot}favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="${toRoot}apple-touch-icon.png" />
<script>
try { const t = localStorage.getItem('clausedown-site-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t } catch {}
try { localStorage.setItem('clausedown-lang', '${lang}') } catch {}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="${toRoot}docs/docs.css" />
</head>
<body data-root="${toRoot}" data-lang="${lang}">
<a class="skip" href="#content">${esc(ui.skip)}</a>
<header class="top">
<div class="l"><a href="${home}" aria-label="ClauseDown"><span class="logo" role="img" aria-label="ClauseDown" style="--logo: url('${toRoot}clausedown_logo.svg')"></span></a><a class="section" href="${docsRoot}">${esc(ui.docs)}</a></div>
<div class="r">
<button class="menu-btn" type="button" aria-controls="side" aria-expanded="false">${ICON.menu}<span>${esc(ui.menu)}</span></button>
<div class="search" role="search">
<label class="search-box">${ICON.search}<input id="q" type="search" placeholder="${esc(ui.search)}" aria-label="${esc(ui.search)}" autocomplete="off" spellcheck="false" /><kbd>/</kbd></label>
<div class="hits" id="hits" role="listbox" hidden data-empty="${esc(ui.noHit)}"></div>
</div>
<nav class="links" aria-label="ClauseDown">
<a href="${home}">${esc(ui.top)}</a>
<a href="${home}#demo">${esc(ui.demo)}</a>
<a href="${REPO}" target="_blank" rel="noreferrer noopener">GitHub</a>
</nav>
<div class="ctl">
<a class="icon-btn" href="${otherHref}" hreflang="${lang === 'ja' ? 'en' : 'ja'}" lang="${lang === 'ja' ? 'en' : 'ja'}" title="${lang === 'ja' ? 'English' : '日本語'}" aria-label="${lang === 'ja' ? 'English' : '日本語'}">${ICON.globe}<span>${lang === 'ja' ? 'EN' : 'JA'}</span></a>
<button class="icon-btn theme" type="button" id="theme" data-dark-label="${esc(ui.toDark)}" data-light-label="${esc(ui.toLight)}" aria-label="${esc(ui.toDark)}">${ICON.moon}${ICON.sun}</button>
</div>
<a class="btn" href="${home}#get">${esc(ui.download)}</a>
</div>
</header>
<div class="layout">
<nav class="side" id="side" aria-label="${esc(ui.chapters)}">
<a class="side-home${slug ? '' : ' is-current'}" href="${docsRoot}"${slug ? '' : ' aria-current="page"'}>${esc(ui.docs)}</a>
<ol>${nav}</ol>
</nav>
<main id="content" class="main${toc ? ' has-toc' : ''}">
<article class="doc">
${body}
${pager}
<p class="edit"><a href="${REPO}/edit/master/${editPath}" target="_blank" rel="noreferrer noopener">${esc(ui.edit)}</a></p>
</article>
${toc}
</main>
</div>
<footer class="foot"><span>© ClauseDown</span><span>${esc(ui.license)}</span><a href="${REPO}" target="_blank" rel="noreferrer noopener">GitHub</a></footer>
<script src="${toRoot}docs/docs.js" defer></script>
</body>
</html>
`
}

function build() {
	const write = (rel, text) => {
		const file = path.join(OUT, rel)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, text)
	}
	const all = { ja: load('ja'), en: load('en') }
	const urls = []
	for (const lang of ['ja', 'en']) {
		const data = all[lang]
		const ui = UI[lang]
		const prefix = lang === 'en' ? 'docs/en/' : 'docs/'
		const depthRoot = lang === 'en' ? '../../' : '../'
		const index = []
		data.chapters.forEach((ch, i) => {
			const { html, sections } = renderChapter(ch, data)
			const prev = data.chapters[i - 1]
			const next = data.chapters[i + 1]
			const body = `<p class="kicker">${esc(ui.chapter(ch.num))}</p><h1>${esc(ch.title)}</h1>\n${html}`
			const description = plain(data.md.render(ch.body.split('\n').find((l) => l.trim() && !/^[#|!>-]/.test(l.trim())) ?? ch.title))
				.trim()
				.slice(0, 160)
			write(
				`${prefix}${ch.slug}/index.html`,
				page({
					data,
					ui,
					slug: ch.slug,
					title: `${ch.title}｜${ui.title}`,
					description,
					body,
					sections,
					prev: prev ? { href: `../${prev.slug}/`, title: prev.title } : { href: './../', title: ui.docs },
					next: next ? { href: `../${next.slug}/`, title: next.title } : null,
					toRoot: `../${depthRoot}`,
					otherHref: `../${depthRoot}docs/${lang === 'ja' ? 'en/' : ''}${ch.slug}/`,
				}),
			)
			urls.push(`${ORIGIN}/${prefix}${ch.slug}/`)
			index.push(...searchEntries(ch, data, `${prefix}${ch.slug}/`))
		})
		const cards = data.chapters
			.map((ch) => {
				const { sections } = renderChapter(ch, data)
				const shown = sections.slice(0, 4)
				return `<li class="card"><a class="card-h" href="${ch.slug}/"><span class="n">${esc(ui.chapter(ch.num))}</span><b>${esc(ch.title)}</b></a>${shown.length ? `<ul>${shown.map((s) => `<li><a href="${ch.slug}/#${esc(s.id)}">${esc(s.text)}</a></li>`).join('')}${sections.length > shown.length ? `<li class="more">${esc(ui.more(sections.length - shown.length))}</li>` : ''}</ul>` : ''}</li>`
			})
			.join('')
		const intro = data.md.render(data.intro)
		write(
			`${prefix}index.html`,
			page({
				data,
				ui,
				slug: '',
				title: ui.title,
				description: plain(intro).replace(/\s+/g, ' ').trim().slice(0, 160),
				body: `<p class="kicker">${esc(ui.docs)}</p><h1>${esc(data.title)}</h1><div class="lead">${intro}</div><ol class="cards">${cards}</ol>`,
				next: { href: `${data.chapters[0].slug}/`, title: data.chapters[0].title },
				toRoot: depthRoot,
				otherHref: `${depthRoot}docs/${lang === 'ja' ? 'en/' : ''}`,
			}),
		)
		urls.push(`${ORIGIN}/${prefix}`)
		write(`${prefix}search.json`, JSON.stringify(index))

		const map = {}
		for (const [id, a] of data.anchors) map[id] = `${a.slug}/${a.id ? `#${a.id}` : ''}`
		const legacy = lang === 'en' ? 'docs/manual/en/' : 'docs/manual/'
		const target = lang === 'en' ? '../../en/' : '../'
		write(
			`${legacy}index.html`,
			`<!doctype html><html lang="${lang}"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><title>${esc(ui.title)}</title><link rel="canonical" href="${ORIGIN}/${prefix}" />
<script>
const map = ${JSON.stringify(map)}
let hash = ''
try { hash = decodeURIComponent(location.hash.slice(1)) } catch {}
location.replace('${target}' + (map[hash] ?? ''))
</script></head><body><p><a href="${target}">${esc(ui.title)}</a></p></body></html>
`,
		)
	}
	fs.copyFileSync(path.join(ROOT, 'site/docs/docs.css'), path.join(OUT, 'docs/docs.css'))
	fs.copyFileSync(path.join(ROOT, 'site/docs/docs.js'), path.join(OUT, 'docs/docs.js'))
	const today = new Date().toISOString().slice(0, 10)
	write(
		'docs/sitemap.xml',
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `    <url>\n        <loc>${u}</loc>\n        <lastmod>${today}</lastmod>\n    </url>\n`).join('')}</urlset>\n`,
	)
	console.log(`docs: ${urls.length} pages → ${path.relative(ROOT, OUT) || OUT}`)
}

build()
