import { BrowserWindow, dialog } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { DeliverInput, DeliveryRecord, DocBase, ExportRequest } from '../shared/api'
import { mermaidSvg, parseFence } from '../shared/blocks'
import { compareSources } from '../shared/article-diff'
import { compareToDocx, docToDocx, inlineToDocx, type Figures, type Images } from '../shared/docx-export'
import { imageLine, imagePathOf, rewriteImages } from '../shared/images'
import { dataUrl, readImage } from './images'
import { toHouritsu } from '../shared/houritsu'
import { LEGAL_CSS } from '../shared/legal-css'
import { displayLine, MATH_CSS, mathKey, renderMath } from '../shared/math'
import { parseLegal, type Item, type LegalDoc, type Paragraph } from '../shared/legal-parser'
import { renderCompareTable, renderDoc, renderInlineDiff } from '../shared/legal-renderer'
import { cleanStyle, DEFAULT_STYLE, styleVars, type DocStyle } from '../shared/prefs'
import { loadSettings } from './settings'
import { deliver, type Builders } from './workflow'
import { listFolderStyles } from './folder-style'
import { resolveStyle } from '../shared/folder-style'
import { scheduleIcs } from './schedule'

const HIDDEN_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`
function hiddenWindow(width?: number, height?: number) {
    const w = new BrowserWindow({ show: false, width, height, webPreferences: { javascript: false, sandbox: true } })
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    return w
}

const userCss = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1')

function page(body: string, title: string, style: DocStyle, landscape = false, css = ''): string {
    const margin = landscape ? Math.min(style.margin, 15) : style.margin
    return `<!doctype html><html lang="ja"><head>${HIDDEN_CSP}<meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title>
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
    const fromText = (t: string) => t.split('\n').forEach((l) => {
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
    for (const line of source.split('\n')) {
        const im = imageLine(line)
        if (!im || images.has(im.src)) continue
        const img = await readImage(base.dir, base.docPath, im.src)
        if (img && img.width && img.height && img.ext !== 'webp') images.set(im.src, { data: img.data, type: img.ext === 'jpeg' ? 'jpg' : img.ext, width: img.width, height: img.height })
    }
    return images
}

export function makeBuilders(style: DocStyle, css = '', base?: DocBase): Builders {
    return {
        docPdf: async (src) => {
            const doc = parseLegal(src)
            return toPdf(await inlineImages(page(renderDoc(doc), doc.title, style, false, css), base), false, style)
        },
        docDocx: async (src) => {
            const doc = parseLegal(src)
            return docToDocx(doc, await rasterizeFigures(doc), style, await loadImages(src, base))
        },
        cmpPdf: async (o, n, title) =>
            toPdf(await inlineImages(page(renderCompareTable(compareSources(o, n), { title, omitUnchanged: true }), title, style, true, css), base), true, style),
        cmpDocx: (o, n, title) => compareToDocx(compareSources(o, n), { title, omitUnchanged: true, style }),
    }
}

const baseOf = (req: { dir?: string; docPath?: string }): DocBase | undefined =>
    typeof req.dir === 'string' && typeof req.docPath === 'string' ? { dir: req.dir, docPath: req.docPath } : undefined

export async function previewPdf(source: string, style: DocStyle, base?: DocBase): Promise<Uint8Array> {
    const { prefs } = await loadSettings()
    return makeBuilders(cleanStyle(style ?? DEFAULT_STYLE), prefs.typesetCss, baseOf(base ?? {})).docPdf(String(source))
}

async function build(req: ExportRequest): Promise<Uint8Array> {
    const style = cleanStyle(req.style ?? DEFAULT_STYLE)
    const { prefs } = await loadSettings()
    const b = makeBuilders(style, prefs.typesetCss, baseOf(req))
    if (req.kind === 'doc' && req.format === 'md') return new TextEncoder().encode(toHouritsu(req.source))
    if (req.kind === 'doc') return req.format === 'docx' ? b.docDocx(req.source) : b.docPdf(req.source)
    const rows = compareSources(req.oldSource, req.newSource)
    const opts = { title: req.title, omitUnchanged: req.omitUnchanged }
    if (req.compareStyle === 'inline') {
        if (req.format === 'docx') return inlineToDocx(rows, { ...opts, style })
        const head = `<p class="cd-title">${req.title.replace(/[<>&]/g, '')}</p><p style="text-align: center; margin-bottom: 1em"><del class="cd-del">削除文字</del>　<ins class="cd-ins">追加文字</ins></p>`
        return toPdf(await inlineImages(page(head + renderInlineDiff(rows, opts), req.title, style, false, prefs.typesetCss), baseOf(req)), false, style)
    }
    if (req.format === 'docx') return compareToDocx(rows, { ...opts, style })
    return toPdf(await inlineImages(page(renderCompareTable(rows, opts), req.title, style, true, prefs.typesetCss), baseOf(req)), true, style)
}

const today = () => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

export async function exportFile(parent: BrowserWindow | null, req: ExportRequest): Promise<string | null> {
    const { prefs } = await loadSettings()
    const ext = req.format
    const name = prefs.exportDateSuffix ? `${req.name}_${today()}` : req.name
    const filters = [{ name: ext === 'pdf' ? 'PDF' : ext === 'md' ? 'Markdown' : 'Word 文書', extensions: [ext] }]
    const opts = { defaultPath: prefs.exportDir ? join(prefs.exportDir, `${name}.${ext}`) : `${name}.${ext}`, filters }
    const result = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, await build(req))
    return result.filePath
}

export async function deliverWithDialog(parent: BrowserWindow | null, dir: string, input: DeliverInput): Promise<DeliveryRecord | null> {
    const { prefs } = await loadSettings()
    const opts = {
        title: '納品一式の保存先を選ぶ',
        defaultPath: prefs.exportDir || undefined,
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    }
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const { style } = resolveStyle(prefs.docStyle, await listFolderStyles(dir), input.docPath)
    return deliver(dir, input, r.filePaths[0], makeBuilders(style, prefs.typesetCss, { dir, docPath: input.docPath }))
}

export async function exportScheduleIcs(parent: BrowserWindow | null, dir: string, today: string): Promise<{ path: string; count: number } | null> {
    const { prefs } = await loadSettings()
    const { name, text, count } = await scheduleIcs(dir, today)
    const file = `${name.replace(/[\/:*?"<>|]/g, '_')}.ics`
    const opts = {
        title: '期日をカレンダーの形式で書き出す',
        defaultPath: prefs.exportDir ? join(prefs.exportDir, file) : file,
        filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    }
    const result = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return null
    await fsp.writeFile(result.filePath, text, 'utf8')
    return { path: result.filePath, count }
}
