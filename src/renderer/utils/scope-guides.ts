import { RangeSetBuilder, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, gutter, GutterMarker, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { LegalDoc } from '@shared/legal-parser'

export interface Span {
    from: number
    to: number
}

export interface Block extends Span {
    depth: number
}

export interface Scopes {
    chapters: Span[]
    articles: Span[]
    blocks: Block[]
    blockDepth: number[]
    indent: number[]
}

const OPEN_RE = /^\s*:{3,}\s*\S/
const CLOSE_RE = /^\s*:{3,}\s*$/
const FENCE_RE = /^\s*(`{3,}|~{3,})/

function trimEnd(lines: string[], from: number, to: number): number {
    let end = to
    while (end > from && !lines[end]?.trim()) end--
    return end
}

export function computeScopes(ld: LegalDoc | null, lines: string[]): Scopes {
    const last = lines.length - 1
    const chapters: Span[] = []
    const articles: Span[] = []
    if (ld) {
        const heads = ld.chapters.filter((c) => c.line >= 0 && c.line <= last).map((c) => c.line)
        const arts = ld.chapters.flatMap((c) => c.articles.map((a) => a.line)).filter((l) => l >= 0 && l <= last)
        const nextAfter = (list: number[], line: number) => list.find((l) => l > line) ?? last + 1
        for (const ch of ld.chapters) {
            if (ch.line < 0 || ch.line > last || ch.kind === 'none') continue
            chapters.push({ from: ch.line, to: trimEnd(lines, ch.line, nextAfter(heads, ch.line) - 1) })
        }
        for (const line of arts) {
            const end = Math.min(nextAfter(arts, line), nextAfter(heads, line)) - 1
            articles.push({ from: line, to: trimEnd(lines, line, end) })
        }
    }

    const blocks: Block[] = []
    const blockDepth = Array.from({ length: lines.length }, () => 0)
    const indent = Array.from({ length: lines.length }, () => -1)
    const stack: Block[] = []
    let fence = ''
    lines.forEach((text, i) => {
        const f = FENCE_RE.exec(text)
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''
            blockDepth[i] = stack.length
            indent[i] = 0
            return
        }
        if (f) fence = f[1]
        if (CLOSE_RE.test(text) && stack.length) {
            const b = stack.pop()!
            b.to = i
            blockDepth[i] = stack.length
            indent[i] = 0
            return
        }
        blockDepth[i] = stack.length
        if (OPEN_RE.test(text) && !f) {
            const b: Block = { from: i, to: last, depth: stack.length + 1 }
            blocks.push(b)
            stack.push(b)
            indent[i] = 0
            return
        }
        if (text.trim()) indent[i] = Math.floor((/^ */.exec(text)![0].length || 0) / 2)
    })
    for (let i = 0; i < indent.length; i++) {
        if (indent[i] >= 0) continue
        let p = i - 1
        while (p >= 0 && indent[p] < 0) p--
        let n = i + 1
        while (n < indent.length && indent[n] < 0) n++
        indent[i] = Math.min(p >= 0 ? indent[p] : 0, n < indent.length ? indent[n] : 0)
    }
    return { chapters, articles, blocks, blockDepth, indent }
}

const within = (spans: Span[], line: number) => spans.find((s) => s.from <= line && line <= s.to)

export function innermostBlock(blocks: Block[], line: number): Block | undefined {
    let best: Block | undefined
    for (const b of blocks) if (b.from <= line && line <= b.to && (!best || b.depth > best.depth)) best = b
    return best
}

export interface GuideOptions {
    chapter: boolean
    article: boolean
    block: boolean
    indent: boolean
}

export const ALL_GUIDES: GuideOptions = { chapter: true, article: true, block: true, indent: true }

interface ScopeState {
    scopes: Scopes
    line: number
}

export function scopeGuides(
    legal: (state: EditorState) => LegalDoc | null,
    isLegalUpdate: (tr: Transaction) => boolean,
    opts: GuideOptions = ALL_GUIDES,
): Extension {
    const build = (state: EditorState): ScopeState => ({
        scopes: computeScopes(legal(state), state.doc.toString().split('\n')),
        line: state.doc.lineAt(state.selection.main.head).number - 1,
    })
    const field = StateField.define<ScopeState>({
        create: build,
        update: (v, tr) => {
            if (tr.docChanged || isLegalUpdate(tr)) return build(tr.state)
            if (tr.selection) return { scopes: v.scopes, line: tr.state.doc.lineAt(tr.state.selection.main.head).number - 1 }
            return v
        },
    })

    const scopeGutter = gutter({
        class: 'cd-scope-gutter',
        lineMarker(view, block) {
            const { scopes, line: cur } = view.state.field(field)
            const line = view.state.doc.lineAt(block.from).number - 1
            const ch = opts.chapter ? within(scopes.chapters, line) : undefined
            const ar = opts.article ? within(scopes.articles, line) : undefined
            if (!ch && !ar) return null
            const part = (s: Span | undefined) => (s ? { start: s.from === line, end: s.to === line, active: s.from <= cur && cur <= s.to } : null)
            return new BandMarker(part(ch), part(ar), opts)
        },
        lineMarkerChange: (u) => u.docChanged || u.selectionSet || u.transactions.some(isLegalUpdate),
        initialSpacer: () => new BandMarker(null, null, opts),
    })

    const decorations = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet
            constructor(view: EditorView) {
                this.decorations = guideDecorations(view, view.state.field(field), opts)
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.field(field) !== u.state.field(field))
                    this.decorations = guideDecorations(u.view, u.state.field(field), opts)
            }
        },
        { decorations: (v) => v.decorations },
    )

    return [field, opts.chapter || opts.article ? scopeGutter : [], decorations]
}

interface BandPart {
    start: boolean
    end: boolean
    active: boolean
}

class BandMarker extends GutterMarker {
    constructor(
        readonly ch: BandPart | null,
        readonly ar: BandPart | null,
        readonly opts: GuideOptions,
    ) {
        super()
    }
    override eq(o: BandMarker): boolean {
        return JSON.stringify([this.ch, this.ar]) === JSON.stringify([o.ch, o.ar])
    }
    override toDOM(): HTMLElement {
        const el = document.createElement('div')
        el.className = 'cd-band'
        for (const [p, kind, on] of [
            [this.ch, 'ch', this.opts.chapter],
            [this.ar, 'ar', this.opts.article],
        ] as const) {
            if (!on) continue
            const s = document.createElement('span')
            s.className = `cd-band-${kind}`
            if (p) {
                s.classList.add('is-on')
                if (p.start) s.classList.add('is-start')
                if (p.end) s.classList.add('is-end')
                if (p.active) s.classList.add('is-active')
            }
            el.appendChild(s)
        }
        return el
    }
}

const BLOCK_STEP = 14
const BASE_PAD = 6

const HANG_RE = /^( *)(?:[-*+] +|\d+[.)] +)?/

export function hangOf(text: string): number {
    if (!text.trim()) return 0
    return HANG_RE.exec(text)![0].length
}

function guideDecorations(view: EditorView, st: ScopeState, opts: GuideOptions): DecorationSet {
    const { scopes, line: cur } = st
    const active = opts.block ? innermostBlock(scopes.blocks, cur) : undefined
    const builder = new RangeSetBuilder<Decoration>()
    const matched = active && (active.from === cur || active.to === cur) ? [active.from, active.to] : []
    for (const { from, to } of view.visibleRanges) {
        let pos = from
        while (pos <= to) {
            const ln = view.state.doc.lineAt(pos)
            const i = ln.number - 1
            const depth = opts.block ? (scopes.blockDepth[i] ?? 0) : 0
            const levels = opts.indent ? (scopes.indent[i] ?? 0) : 0
            const layers: { x: string; on: boolean }[] = []
            for (let d = 0; d < depth; d++) {
                const owner = active && active.depth === d + 1 && active.from < i && i < active.to
                layers.push({ x: `${BASE_PAD + d * BLOCK_STEP}px`, on: !!owner })
            }
            const pad = BASE_PAD + depth * BLOCK_STEP
            for (let j = 0; j < levels; j++) layers.push({ x: `calc(${pad}px + ${j * 2}ch)`, on: false })
            const hang = hangOf(ln.text)
            if (layers.length || depth || hang) {
                const style = [
                    hang ? `padding-left:calc(${pad}px + ${hang}ch);text-indent:-${hang}ch` : depth ? `padding-left:${pad}px` : '',
                    layers.length
                        ? `background-image:${layers.map((l) => `linear-gradient(var(${l.on ? '--cd-guide-active' : '--cd-guide'}),var(${l.on ? '--cd-guide-active' : '--cd-guide'}))`).join(',')}`
                        : '',
                    layers.length ? `background-position:${layers.map((l) => `${l.x} 0`).join(',')}` : '',
                    layers.length ? `background-size:${layers.map((l) => `${l.on ? 2 : 1}px 100%`).join(',')}` : '',
                    layers.length ? 'background-repeat:no-repeat' : '',
                ]
                    .filter(Boolean)
                    .join(';')
                builder.add(ln.from, ln.from, Decoration.line({ class: 'cd-guided', attributes: { style } }))
            }
            if (matched.includes(i)) {
                const m = /:{3,}/.exec(ln.text)
                if (m) builder.add(ln.from + m.index, ln.from + m.index + m[0].length, Decoration.mark({ class: 'cd-block-match' }))
            }
            pos = ln.to + 1
        }
    }
    return builder.finish()
}

export const scopeTheme = EditorView.theme({
    '.cd-scope-gutter': { padding: '0 3px 0 2px' },
    '.cd-scope-gutter .cm-gutterElement': { padding: '0' },
    '.cd-band': { display: 'flex', gap: '3px', height: '100%' },
    '.cd-band > span': { width: '3px', height: '100%', boxSizing: 'border-box' },
    '.cd-band > span.is-on': { backgroundColor: 'var(--cd-guide)' },
    '.cd-band > span.is-start': { marginTop: '6px', height: 'calc(100% - 6px)', borderTopLeftRadius: '2px', borderTopRightRadius: '2px' },
    '.cd-band > span.is-end': { borderBottomLeftRadius: '2px', borderBottomRightRadius: '2px' },
    '.cd-band > span.is-end:not(.is-start)': { height: 'calc(100% - 6px)' },
    '.cd-band > span.is-start.is-end': { height: 'calc(100% - 12px)' },
    '.cd-band > span.cd-band-ch.is-active': { backgroundColor: 'var(--cd-band-ch)' },
    '.cd-band > span.cd-band-ar.is-active': { backgroundColor: 'var(--cd-band-ar)' },
    '.cd-block-match': { backgroundColor: 'var(--cd-block-match)', borderRadius: '2px' },
})
