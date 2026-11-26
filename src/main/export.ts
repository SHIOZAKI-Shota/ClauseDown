import { BrowserWindow, dialog } from 'electron'
import { remember } from './memo'
import { localYmd } from '../shared/date'
import { PDF } from '@libpdf/core'
import { t } from '../shared/i18n'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { DeliverInput, DeliveryRecord, DocBase, ExportRequest } from '../shared/api'
import { mermaidSvg, parseFence } from '../shared/blocks'
import { compareSources } from '../shared/article-diff'
import { compareToDocx, docToDocx, inlineToDocx, type Figures, type Images } from '../shared/docx-export'
import { compareWords } from '../shared/legal-styles'
import { imagePathOf, inlineImages as findImages, rewriteImages } from '../shared/images'
import { dataUrl, readImage } from './images'
import { toHouritsu } from '../shared/houritsu'
import { LEGAL_CSS } from '../shared/legal-css'
import { MARK_RE, withLineMarks } from '../shared/line-marks'
import { displayLine, MATH_CSS, mathKey, renderMath } from '../shared/math'
import { docLang, parseLegal, type Item, type LegalDoc, type Paragraph } from '../shared/legal-parser'
import { renderCompareTable, renderDoc, renderInlineDiff, type RenderOptions } from '../shared/legal-renderer'
import { tocEntries, tocPagesFrom, type TocSpot } from '../shared/toc'
import { cleanStyle, DEFAULT_STYLE, styleVars, type DocStyle } from '../shared/prefs'
import { loadSettings } from './settings'
import { deliver, type Builders } from './workflow'
import { listFolderStyles } from './folder-style'
import { resolveStyle } from '../shared/folder-style'
import { scheduleIcs } from './schedule'
import { openSignSession, type SignSession } from './sign-service'

const HIDDEN_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`
function hiddenWindow(width?: number, height?: number) {
	const w = new BrowserWindow({ show: false, width, height, webPreferences: { javascript: false, sandbox: true } })
	w.webContents.on('will-navigate', (e) => e.preventDefault())
	w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
	return w
}

const userCss = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1')

function page(body: string, title: string, style: DocStyle, landscape = false, css = '', lang: string = 'ja'): string {
	const margin = landscape ? Math.min(style.margin, 15) : style.margin
	return `<!doctype html><html lang="${lang}"><head>${HIDDEN_CSP}<meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title>
<style>@page { size: A4${landscape ? ' landscape' : ''}; margin: ${margin}mm; } body { margin: 0; } ${MATH_CSS}
${css ? userCss(css) : LEGAL_CSS}
:root { ${styleVars(style)} }</style></head><body>${body}</body></html>`
}

async function toPdf(html: string, landscape: boolean, style: DocStyle): Promise<Buffer> {
	const win = hiddenWindow()
	try {
		await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
		return await win.webContents.printToPDF({
			pageSize: 'A4',
			landscape,
			printBackground: true,
			preferCSSPageSize: true,
			displayHeaderFooter: style.pageNumbers,
			headerTemplate: '<div></div>',
			footerTemplate:
				'<div style="width:100%;text-align:center;font-size:8pt;color:#555;font-family:serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
		})
	} finally {
		win.destroy()
	}
}

async function markSpots(bytes: Uint8Array): Promise<Map<number, TocSpot>> {
	const pdf = await PDF.load(bytes)
	const out = new Map<number, TocSpot>()
	pdf.extractText().forEach((p, page) => {
		for (const l of p.lines)
			for (const m of l.text.matchAll(MARK_RE)) {
				const line = Number(m[2])
				if (m[1] === 's' && !out.has(line)) out.set(line, { page, y: l.bbox.y + l.bbox.height })
			}
	})
	return out
}

async function linkToc(bytes: Uint8Array, doc: LegalDoc, spots: Map<number, TocSpot>, offset: number): Promise<Uint8Array> {
	const pdf = await PDF.load(bytes)
	const pages = pdf.getPages()
	const targets = tocEntries(doc)
		.filter((e) => !e.deleted)
		.map((e) => spots.get(e.line))
	const links = pages.flatMap((p) => p.getLinkAnnotations().flatMap((l) => (l.getAction()?.type === 'uri' ? [] : [{ p, l }])))
	if (links.length !== targets.length || targets.some((t) => !t || !pages[t.page + offset])) return bytes
	links.forEach(({ p, l }, i) => {
		const t = targets[i]!
		const rect = l.rect
		p.removeAnnotation(l)
		p.addLinkAnnotation({ rect, destination: { page: pages[t.page + offset], type: 'XYZ', left: 0, top: t.y + 12, zoom: null } })
	})
	return pdf.save()
}

async function docToPdf(doc: LegalDoc, style: DocStyle, css: string, base: DocBase | undefined, marks = false): Promise<Uint8Array> {
	const render = async (opts: RenderOptions, s: DocStyle, withMarks: boolean) => {
		const body = renderDoc(doc, opts)
		return toPdf(await inlineImages(page(withMarks ? withLineMarks(body) : body, doc.title, s, false, css, doc.lang), base), false, s)
	}
	const part = doc.cover ? 'body' : 'all'
	let spots: Map<number, TocSpot> | undefined
	if (doc.toc) {
		try {
			spots = await markSpots(await render({ part, tocPages: 'placeholder' }, style, true))
		} catch {
			spots = undefined
		}
	}
	const body = await render({ part, tocPages: spots && tocPagesFrom(tocEntries(doc), spots) }, style, marks)
	let out: Uint8Array = body
	let offset = 0
	if (doc.cover) {
		const cover = await render({ part: 'cover' }, { ...style, pageNumbers: false }, marks)
		offset = (await PDF.load(cover)).getPageCount()
		out = await (await PDF.merge([cover, body])).save()
	}
	if (!spots) return out
	try {
		return await linkToc(out, doc, spots, offset)
	} catch {
		return out
	}
}

function mermaidBodies(doc: LegalDoc): string[] {
	const out: string[] = []
	const fromBlocks = (blocks: string[]) => {
		for (const b of blocks) {
			const f = parseFence(b)
			if (f?.lang === 'mermaid') out.push(f.body)
		}
	}
	const fromItems = (items: Item[]) => items.forEach((i) => (fromBlocks(i.blocks), fromItems(i.children)))
	const fromParas = (ps: Paragraph[]) => ps.forEach((p) => (fromBlocks(p.blocks), fromItems(p.items)))
	for (const ch of doc.chapters) {
		fromParas(ch.intro)
		ch.articles.forEach((a) => fromParas(a.paragraphs))
		if (ch.kind === 'appendix') {
			for (const m of ch.raw.matchAll(/^(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n\1\s*$/gim)) out.push(m[2])
		}
	}
	return [...new Set(out)]
}

function mathBodies(doc: LegalDoc): string[] {
	const out: string[] = []
	const fromText = (t: string) =>
		t.split('\n').forEach((l) => {
			const tex = displayLine(l)
			if (tex) out.push(tex)
		})
	const fromBlocks = (blocks: string[]) => {
		for (const b of blocks) {
			const f = parseFence(b)
			if (f?.lang === 'math') out.push(f.body)
		}
	}
	const fromItems = (items: Item[]) => items.forEach((i) => (fromText(i.text), fromBlocks(i.blocks), fromItems(i.children)))
	const fromParas = (ps: Paragraph[]) => ps.forEach((p) => (fromText(p.text), fromBlocks(p.blocks), fromItems(p.items)))
	for (const ch of doc.chapters) {
		fromParas(ch.intro)
		ch.articles.forEach((a) => fromParas(a.paragraphs))
	}
	return [...new Set(out.map((t) => t.trim()))]
}

const MATH_PX = 28
const DOC_PX = 14

async function rasterizeMath(texs: string[], figures: Figures): Promise<void> {
	if (!texs.length) return
	const win = new BrowserWindow({ show: false, width: 1600, height: 600, webPreferences: { sandbox: true } })
	win.webContents.on('will-navigate', (e) => e.preventDefault())
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
	try {
		for (const tex of texs) {
			const html = `<!doctype html><html><head>${HIDDEN_CSP}<meta charset="utf-8"><style>${MATH_CSS} html,body{margin:0;background:#fff} #m{display:inline-block;padding:4px 6px;font-size:${MATH_PX}px} .cd-math-display{margin:0}</style></head><body><div id="m">${renderMath(tex, true)}</div></body></html>`
			await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
			const r = (await win.webContents.executeJavaScript(
				`(() => { const b = document.getElementById('m').getBoundingClientRect(); return { w: Math.ceil(b.width), h: Math.ceil(b.height) } })()`,
			)) as { w: number; h: number }
			if (!r.w || !r.h) continue
			const img = await win.webContents.capturePage({ x: 0, y: 0, width: r.w, height: r.h })
			figures.set(mathKey(tex), { png: img.toPNG(), width: Math.round((r.w * DOC_PX) / MATH_PX), height: Math.round((r.h * DOC_PX) / MATH_PX) })
		}
	} finally {
		win.destroy()
	}
}

async function rasterizeFigures(doc: LegalDoc): Promise<Figures> {
	const figures: Figures = new Map()
	await rasterizeMath(mathBodies(doc), figures)
	const bodies = mermaidBodies(doc)
	if (!bodies.length) return figures
	const win = hiddenWindow(1600, 1600)
	try {
		for (const body of bodies) {
			const { svg, width, height, error } = mermaidSvg(body)
			if (error || !svg) continue
			const w = Math.ceil(width)
			const h = Math.ceil(height)
			const html = `<!doctype html><html><head>${HIDDEN_CSP}<meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:${w}px;height:${h}px;max-width:none!important}</style></head><body>${svg}</body></html>`
			win.setContentSize(Math.max(w, 100), Math.max(h, 100))
			await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
			const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h })
			const size = img.getSize()
			figures.set(body, { png: img.toPNG(), width: size.width, height: size.height })
		}
	} finally {
		win.destroy()
	}
	return figures
}

async function inlineImages(html: string, base: DocBase | undefined): Promise<string> {
	if (!base) return html
	const urls = new Map<string, string | null>()
	const srcs = new Set<string>()
	rewriteImages(html, (src) => (srcs.add(src), null))
	for (const src of srcs) {
		if (!imagePathOf(base.docPath, src)) continue
		const img = await readImage(base.dir, base.docPath, src)
		urls.set(src, img ? dataUrl(img) : null)
	}
	return rewriteImages(html, (src) => urls.get(src) ?? null)
}

async function loadImages(source: string, base: DocBase | undefined): Promise<Images | undefined> {
	if (!base) return undefined
	const images: Images = new Map()
	for (const im of findImages(source)) {
		if (images.has(im.src)) continue
		const img = await readImage(base.dir, base.docPath, im.src)
		if (img && img.width && img.height && img.ext !== 'webp')
			images.set(im.src, { data: img.data, type: img.ext === 'jpeg' ? 'jpg' : img.ext, width: img.width, height: img.height })
	}
	return images
}

export function makeBuilders(style: DocStyle, css = '', base?: DocBase, signer?: SignSession): Builders {
	const sign = (bytes: Uint8Array) => (signer ? signer.sign(bytes) : bytes)
	const parsed = new Map<string, LegalDoc>()
	const parse = (src: string) => parsed.get(src) ?? remember(parsed, src, parseLegal(src), 4)
	const compared = new Map<string, ReturnType<typeof compareSources>>()
	const compare = (o: string, n: string) => compared.get(`${o}\0${n}`) ?? remember(compared, `${o}\0${n}`, compareSources(o, n), 4)
	return {
		docPdf: async (src) => sign(await docToPdf(parse(src), style, css, base)),
		docDocx: async (src) => {
			const doc = parse(src)
			return docToDocx(doc, await rasterizeFigures(doc), style, await loadImages(src, base))
		},
		cmpPdf: async (o, n, title) =>
			sign(
				await toPdf(
					await inlineImages(
						page(
							renderCompareTable(compare(o, n), { title, omitUnchanged: true, lang: docLang(n || o) }),
							title,
							style,
							true,
							css,
							docLang(n || o),
						),
						base,
					),
					true,
					style,
				),
			),
		cmpDocx: (o, n, title) => compareToDocx(compare(o, n), { title, omitUnchanged: true, style, lang: docLang(n || o) }),
	}
}

const screenCss = (margin: number) =>
	`<style>@media screen { html { background: #f4f4f5; } body { box-sizing: border-box; max-width: 210mm; margin: 24px auto; padding: ${margin}mm; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); } }</style>`

async function docHtml(source: string, style: DocStyle, css: string, base?: DocBase): Promise<string> {
	const doc = parseLegal(source)
	return inlineImages(page(screenCss(style.margin) + renderDoc(doc), doc.title, style, false, css, doc.lang), base)
}

const baseOf = (req: { dir?: string; docPath?: string }): DocBase | undefined =>
	typeof req.dir === 'string' && typeof req.docPath === 'string' ? { dir: req.dir, docPath: req.docPath } : undefined

export async function previewPdf(source: string, style: DocStyle, base?: DocBase): Promise<Uint8Array> {
	const { prefs } = await loadSettings()
	const s = cleanStyle(style ?? DEFAULT_STYLE)
	return docToPdf(parseLegal(String(source)), s, prefs.typesetCss, baseOf(base ?? {}), true)
}

async function build(req: ExportRequest, signer?: SignSession): Promise<Uint8Array> {
	const style = cleanStyle(req.style ?? DEFAULT_STYLE)
	const { prefs } = await loadSettings()
	const b = makeBuilders(style, prefs.typesetCss, baseOf(req), signer)
	const sign = (bytes: Uint8Array) => (signer ? signer.sign(bytes) : bytes)
	if (req.kind === 'doc' && req.format === 'md') return new TextEncoder().encode(toHouritsu(req.source))
	if (req.kind === 'doc' && req.format === 'html') return new TextEncoder().encode(await docHtml(req.source, style, prefs.typesetCss, baseOf(req)))
	if (req.kind === 'doc') return req.format === 'docx' ? b.docDocx(req.source) : b.docPdf(req.source)
	const rows = compareSources(req.oldSource, req.newSource)
	const lang = docLang(req.newSource || req.oldSource)
	const words = compareWords(lang)
	const opts = { title: req.title, omitUnchanged: req.omitUnchanged, lang }
	if (req.compareStyle === 'inline') {
		if (req.format === 'docx') return inlineToDocx(rows, { ...opts, style })
		const head = `<p class="cd-title">${req.title.replace(/[<>&]/g, '')}</p><p style="text-align: center; margin-bottom: 1em"><del class="cd-del">${words.deletedText}</del>${lang === 'ja' ? '　' : '&nbsp;&nbsp;'}<ins class="cd-ins">${words.addedText}</ins></p>`
		return sign(
			await toPdf(
				await inlineImages(page(head + renderInlineDiff(rows, opts), req.title, style, false, prefs.typesetCss, lang), baseOf(req)),
				false,
				style,
			),
		)
	}
	if (req.format === 'docx') return compareToDocx(rows, { ...opts, style })
	return sign(await toPdf(await inlineImages(page(renderCompareTable(rows, opts), req.title, style, true, prefs.typesetCss, lang), baseOf(req)), true, style))
}

const today = () => localYmd(new Date(), '')

export async function exportFile(parent: BrowserWindow | null, req: ExportRequest): Promise<string | null> {
	const { prefs } = await loadSettings()
	const ext = req.format
	const name = prefs.exportDateSuffix ? `${req.name}_${today()}` : req.name
	const filters = [{ name: { pdf: 'PDF', md: 'Markdown', html: 'HTML', docx: t().notify.dialogs.wordDoc }[ext], extensions: [ext] }]
	const opts = { defaultPath: prefs.exportDir ? join(prefs.exportDir, `${name}.${ext}`) : `${name}.${ext}`, filters }
	const result = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
	if (result.canceled || !result.filePath) return null
	const signer = req.sign && req.format === 'pdf' ? await openSignSession(parent, { certId: req.certId, pin: req.pin, dir: req.dir }) : undefined
	try {
		await fsp.writeFile(result.filePath, await build(req, signer))
	} finally {
		await signer?.close()
	}
	return result.filePath
}

export async function deliverWithDialog(parent: BrowserWindow | null, dir: string, input: DeliverInput): Promise<DeliveryRecord | null> {
	const { prefs } = await loadSettings()
	const opts = {
		title: t().notify.dialogs.deliveryFolder,
		defaultPath: prefs.exportDir || undefined,
		properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
	}
	const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
	if (r.canceled || !r.filePaths[0]) return null
	const { style } = resolveStyle(prefs.docStyle, await listFolderStyles(dir), input.docPath)
	const pdfs = input.items.some((i) => i === 'docPdf' || i === 'cmpPdf')
	const signer = input.sign && pdfs ? await openSignSession(parent, { certId: input.certId, pin: input.pin, dir }) : undefined
	try {
		return await deliver(dir, { ...input, pin: undefined }, r.filePaths[0], makeBuilders(style, prefs.typesetCss, { dir, docPath: input.docPath }, signer))
	} finally {
		await signer?.close()
	}
}

export async function exportScheduleIcs(parent: BrowserWindow | null, dir: string, today: string): Promise<{ path: string; count: number } | null> {
	const { prefs } = await loadSettings()
	const { name, text, count } = await scheduleIcs(dir, today)
	const file = `${name.replace(/[/:*?"<>|]/g, '_')}.ics`
	const opts = {
		title: t().notify.dialogs.exportIcs,
		defaultPath: prefs.exportDir ? join(prefs.exportDir, file) : file,
		filters: [{ name: 'iCalendar', extensions: ['ics'] }],
	}
	const result = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
	if (result.canceled || !result.filePath) return null
	await fsp.writeFile(result.filePath, text, 'utf8')
	return { path: result.filePath, count }
}
