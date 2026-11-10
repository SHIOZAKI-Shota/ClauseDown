import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { EditorSelection, StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { parseFence, mermaidSvg } from '@shared/blocks'
import type { Article, Item, LegalDoc, Paragraph } from '@shared/legal-parser'
import { articleTitle } from '@shared/legal-parser'

export const legalTheme = EditorView.theme({
    '&': { height: '100%', fontSize: 'var(--cd-ed-size, 14px)', backgroundColor: 'var(--cd-ed-bg)', color: 'var(--cd-ed-text)' },
    '.cm-scroller': { fontFamily: 'var(--cd-ed-font, "BIZ UDGothic", "Yu Gothic UI", "MS Gothic", monospace)', lineHeight: '1.8' },
    '.cm-content': { caretColor: 'var(--cd-ed-cursor)', padding: '12px 0' },
    '.cm-line': { padding: '0 16px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cd-ed-cursor)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--cd-ed-selection) !important' },
    '.cm-activeLine': { backgroundColor: 'var(--cd-ed-active)' },
    '.cm-gutters': { backgroundColor: 'var(--cd-ed-gutter)', color: 'var(--cd-ed-gutter-text)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--cd-ed-active)', color: 'var(--cd-ed-text)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--ui-bg-accented)', border: 'none', color: 'var(--ui-text-muted)' },
    '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', border: '1px solid var(--ui-border)', borderRadius: '8px', color: 'var(--ui-text)' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--ui-color-primary-500)', color: '#fff' },
    '.cm-completionDetail': { marginLeft: '10px', opacity: 0.7, fontStyle: 'normal' },
    '.cm-panels': { backgroundColor: 'var(--ui-bg-elevated)', color: 'var(--ui-text)', borderColor: 'var(--ui-border)' },
    '.cm-panel input, .cm-panel button': { color: 'var(--ui-text)' },
    '.cm-searchMatch': { backgroundColor: 'var(--cd-highlight)' },
    '.cm-diagnostic': { padding: '4px 8px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--cd-syn-ref-bad)', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--cd-draft)', textUnderlineOffset: '3px' },
    '.cd-hint': { marginRight: '6px' },
    '.cd-attr': { color: 'var(--cd-syn-mark)' },
    '.cd-prop': { color: 'var(--cd-syn-mark)', backgroundColor: 'color-mix(in srgb, var(--cd-syn-mark) 10%, transparent)', borderRadius: '3px', fontSize: '0.92em' },
    '.cd-ref': { color: 'var(--cd-syn-ref)', borderBottom: '1px dotted var(--cd-syn-ref)' },
    '.cd-ref-bad': { color: 'var(--cd-syn-ref-bad)', borderBottom: '1px dotted var(--cd-syn-ref-bad)' },
})

const highlight = HighlightStyle.define([
    { tag: t.heading1, color: 'var(--cd-syn-title)', fontWeight: '700', fontSize: '1.15em' },
    { tag: t.heading2, color: 'var(--cd-syn-chapter)', fontWeight: '700' },
    { tag: t.heading3, color: 'var(--cd-syn-article)', fontWeight: '700' },
    { tag: [t.heading4, t.heading5, t.heading6], color: 'var(--cd-syn-article)' },
    { tag: t.processingInstruction, color: 'var(--cd-syn-mark)' },
    { tag: t.list, color: 'var(--cd-ed-text)' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.link, color: 'var(--cd-syn-ref)' },
    { tag: t.url, color: 'var(--cd-syn-mark)' },
    { tag: [t.monospace, t.content], color: 'var(--cd-ed-text)' },
    { tag: t.comment, color: 'var(--cd-syn-mark)', fontStyle: 'italic' },
    { tag: t.meta, color: 'var(--cd-syn-code)' },
    { tag: [t.keyword, t.string, t.number, t.operator, t.typeName], color: 'var(--cd-syn-code)' },
])

export const setLegalDoc = StateEffect.define<LegalDoc>()
interface LegalState {
    ld: LegalDoc
    hints: Map<number, Hint>
}
const legalDocField = StateField.define<LegalState | null>({
    create: () => null,
    update: (v, tr) => {
        for (const e of tr.effects) {
            if (e.is(setLegalDoc)) return v?.ld === e.value ? v : { ld: e.value, hints: new Map(hintsOf(e.value).map((h) => [h.line, h])) }
        }
        return v
    },
})
const hasLegalEffect = (u: ViewUpdate) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setLegalDoc)))

interface Hint {
    line: number
    label: string
    kind: 'chapter' | 'article' | 'para' | 'item'
}

export function hintsOf(doc: LegalDoc): Hint[] {
    const out: Hint[] = []
    const items = (list: Item[]) => {
        for (const it of list) {
            if (it.line >= 0) out.push({ line: it.line, label: it.label, kind: 'item' })
            items(it.children)
        }
    }
    const paras = (list: Paragraph[], first?: string) => {
        list.forEach((p, i) => {
            const label = i === 0 && first && !p.label ? '' : p.label
            if (p.line >= 0 && label) out.push({ line: p.line, label, kind: 'para' })
            items(p.items)
        })
    }
    for (const ch of doc.chapters) {
        if (ch.label && ch.line >= 0) out.push({ line: ch.line, label: ch.label, kind: 'chapter' })
        paras(ch.intro)
        for (const a of ch.articles) {
            out.push({ line: a.line, label: a.deleted ? `${a.label} 削除` : a.label, kind: 'article' })
            paras(a.paragraphs, a.label)
        }
    }
    return out
}

class HintWidget extends WidgetType {
    constructor(
        readonly label: string,
        readonly kind: string,
    ) {
        super()
    }
    override eq(o: HintWidget) {
        return o.label === this.label && o.kind === this.kind
    }
    toDOM() {
        const el = document.createElement('span')
        el.className = `cd-hint cd-hint-${this.kind}`
        el.textContent = this.label
        return el
    }
    override ignoreEvent() {
        return true
    }
}

const ATTR_RE = /\s\{[^{}]*\}\s*$/
const REF_RE = /\[\[([^\]:]+)(?::\d+)?(?::\d+)?\]\]/g
const PROP_INLINE_RE = /\](\{[^{}]*\})/g
const PROP_LINE_RE = /^\s*(?::{3,}.*|\{[^{}]*\})\s*$/

function buildDecorations(view: EditorView): DecorationSet {
    const st = view.state.field(legalDocField)
    const ld = st?.ld
    const builder = new RangeSetBuilder<Decoration>()
    const hints = st?.hints
    for (const { from, to } of view.visibleRanges) {
        let pos = from
        while (pos <= to) {
            const line = view.state.doc.lineAt(pos)
            const h = hints?.get(line.number - 1)
            const marks: { from: number; to: number; deco: Decoration }[] = []
            if (h) {
                const m = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?)/.exec(line.text)!
                marks.push({ from: line.from + m[1].length, to: line.from + m[1].length, deco: Decoration.widget({ widget: new HintWidget(h.label, h.kind), side: -1 }) })
            }
            if (/^#{1,6}\s/.test(line.text)) {
                const a = ATTR_RE.exec(line.text)
                if (a) marks.push({ from: line.from + a.index, to: line.to, deco: Decoration.mark({ class: 'cd-attr' }) })
            }
            if (PROP_LINE_RE.test(line.text)) marks.push({ from: line.from, to: line.to, deco: Decoration.mark({ class: 'cd-prop' }) })
            else for (const r of line.text.matchAll(PROP_INLINE_RE)) marks.push({ from: line.from + r.index! + 1, to: line.from + r.index! + r[0].length, deco: Decoration.mark({ class: 'cd-prop' }) })
            for (const r of line.text.matchAll(REF_RE)) {
                const ok = !!ld?.refs[r[1].trim()]
                marks.push({ from: line.from + r.index!, to: line.from + r.index! + r[0].length, deco: Decoration.mark({ class: ok ? 'cd-ref' : 'cd-ref-bad' }) })
            }
            marks.sort((x, y) => x.from - y.from)
            for (const mk of marks) builder.add(mk.from, mk.to, mk.deco)
            pos = line.to + 1
        }
    }
    return builder.finish()
}

const legalDecorations = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        constructor(view: EditorView) {
            this.decorations = buildDecorations(view)
        }
        update(u: ViewUpdate) {
            if (u.docChanged || u.viewportChanged || hasLegalEffect(u)) this.decorations = buildDecorations(u.view)
        }
    },
    { decorations: (v) => v.decorations },
)

function idFor(a: Article, ld: LegalDoc): string {
    const base = (a.title || a.label).replace(/[\s{}[\]:#]/g, '')
    let id = base
    for (let n = 2; ld.refs[id] && ld.refs[id] !== a; n++) id = `${base}${n}`
    return id
}

function refCompletions(ctx: CompletionContext) {
    const m = ctx.matchBefore(/\[\[[^\]\n]*/)
    if (!m) return null
    const ld = ctx.state.field(legalDocField)?.ld
    if (!ld) return null
    const options: Completion[] = []
    for (const ch of ld.chapters) {
        for (const a of ch.articles) {
            if (a.deleted) continue
            const id = a.id ?? idFor(a, ld)
            options.push({
                label: `${a.refLabel}${a.title ? `（${articleTitle(a, ld)}）` : ''}`,
                detail: a.id ? `[[${a.id}]]` : '名前を付けて参照',
                apply: (view, _c, from, to) => {
                    from -= 2
                    if (view.state.sliceDoc(to, to + 2) === ']]') to += 2
                    const changes = [{ from, to, insert: `[[${id}]]` }]
                    if (!a.id) {
                        const line = view.state.doc.line(a.line + 1)
                        const attr = ATTR_RE.exec(line.text)
                        if (attr) changes.push({ from: line.from + attr.index + attr[0].indexOf('{') + 1, to: line.from + attr.index + attr[0].indexOf('{') + 1, insert: `#${id} ` })
                        else changes.push({ from: line.to, to: line.to, insert: ` {#${id}}` })
                    }
                    const shift = changes.slice(1).reduce((n, c) => (c.from < from ? n + c.insert.length : n), 0)
                    view.dispatch(view.state.update({ changes, selection: EditorSelection.cursor(from + shift + id.length + 4) }))
                },
            })
        }
    }
    return { from: m.from + 2, options, filter: true, validFor: /^[^\]\n]*$/ }
}

const mermaidErrors = new Map<string, string | undefined>()
function mermaidError(body: string): string | undefined {
    if (mermaidErrors.has(body)) return mermaidErrors.get(body)
    const { error } = mermaidSvg(body)
    if (mermaidErrors.size >= 200) mermaidErrors.clear()
    mermaidErrors.set(body, error)
    return error
}

const legalLinter = linter(
    (view) => {
        const ld = view.state.field(legalDocField)?.ld
        if (!ld) return []
        const out: Diagnostic[] = []
        const text = view.state.doc.toString()
        for (const r of text.matchAll(REF_RE)) {
            if (!ld.refs[r[1].trim()]) {
                out.push({ from: r.index!, to: r.index! + r[0].length, severity: 'error', message: `「${r[1]}」という名前の条がありません` })
            }
        }
        for (const f of text.matchAll(/^[ \t]*(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)) {
            const fence = parseFence(f[0].replace(/^[ \t]+/gm, ''))
            if (!fence) continue
            const error = mermaidError(fence.body)
            if (error) out.push({ from: f.index!, to: f.index! + f[0].length, severity: 'warning', message: `図を描けません：${error}` })
        }
        for (const w of ld.warnings) {
            const m = /^(\d+)行目/.exec(w)
            const line = m ? view.state.doc.line(Math.min(Number(m[1]), view.state.doc.lines)) : view.state.doc.line(1)
            out.push({ from: line.from, to: line.to, severity: 'warning', message: w })
        }
        return out
    },
    { delay: 400, needsRefresh: hasLegalEffect },
)

function shiftList(dir: 1 | -1) {
    return (view: EditorView) => {
        const changes: { from: number; to: number; insert: string }[] = []
        for (const r of view.state.selection.ranges) {
            const first = view.state.doc.lineAt(r.from).number
            const last = view.state.doc.lineAt(r.to).number
            for (let n = first; n <= last; n++) {
                const line = view.state.doc.line(n)
                if (!/^\s*[-*+]\s/.test(line.text)) return false
                if (dir === 1) changes.push({ from: line.from, to: line.from, insert: '  ' })
                else {
                    const sp = /^ {1,2}/.exec(line.text)
                    if (sp) changes.push({ from: line.from, to: line.from + sp[0].length, insert: '' })
                }
            }
        }
        if (!changes.length) return false
        view.dispatch({ changes })
        return true
    }
}

export function legalExtensions(): Extension[] {
    return [
        legalTheme,
        syntaxHighlighting(highlight),
        indentUnit.of('  '),
        legalDocField,
        legalDecorations,
        autocompletion({ override: [refCompletions], activateOnTyping: true, icons: false }),
        legalLinter,
        keymap.of([
            { key: 'Tab', run: shiftList(1) },
            { key: 'Shift-Tab', run: shiftList(-1) },
        ]),
    ]
}

interface PositionIndex {
    lines: number[]
    labels: string[]
}
const positionIndexes = new WeakMap<LegalDoc, PositionIndex>()
function positionIndex(ld: LegalDoc): PositionIndex {
    const hit = positionIndexes.get(ld)
    if (hit) return hit
    const idx: PositionIndex = { lines: [], labels: [] }
    const add = (line: number, label: string) => {
        idx.lines.push(line)
        idx.labels.push(label)
    }
    for (const ch of ld.chapters) {
        if (ch.line >= 0 && ch.label) add(ch.line, ch.label)
        for (const a of ch.articles) {
            add(a.line, a.label)
            for (const p of a.paragraphs) {
                if (p.line >= 0) add(p.line, `${a.label}第${p.number}項`)
                const walk = (items: Item[]) => {
                    for (const it of items) {
                        add(it.line, `${a.label}第${p.number}項 ${it.label}`)
                        walk(it.children)
                    }
                }
                walk(p.items)
            }
        }
    }
    positionIndexes.set(ld, idx)
    return idx
}

export function lastAtOrBefore(sorted: readonly number[], x: number): number {
    let lo = 0
    let hi = sorted.length - 1
    let found = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid] <= x) {
            found = mid
            lo = mid + 1
        } else hi = mid - 1
    }
    return found
}

export function positionLabel(ld: LegalDoc, line: number): string {
    const idx = positionIndex(ld)
    const i = lastAtOrBefore(idx.lines, line)
    return i < 0 ? '' : idx.labels[i]
}
