import { diffChars, diffLines } from 'diff'
import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export const setDiffBase = StateEffect.define<string | null>()

const baseField = StateField.define<string | null>({
    create: () => null,
    update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setDiffBase) ? e.value : acc), v),
})

class Removed extends WidgetType {
    constructor(readonly text: string) {
        super()
    }
    override eq(o: Removed) {
        return o.text === this.text
    }
    toDOM() {
        const el = document.createElement('span')
        el.className = 'cd-diff-del'
        el.textContent = this.text
        el.title = '保存した版から消した文字'
        return el
    }
    override ignoreEvent() {
        return false
    }
}

const added = Decoration.mark({ class: 'cd-diff-add' })

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff
const LARGE = 200_000
const MAX_REMOVED = 4000

function build(base: string | null, doc: string): DecorationSet {
    if (base === null || base === doc) return Decoration.none
    const max = Math.min(base.length, doc.length)
    let head = 0
    while (head < max && base.charCodeAt(head) === doc.charCodeAt(head)) head++
    if (head > 0 && isHigh(base.charCodeAt(head - 1))) head--
    let tail = 0
    while (tail < max - head && base.charCodeAt(base.length - 1 - tail) === doc.charCodeAt(doc.length - 1 - tail)) tail++
    if (tail > 0 && isLow(base.charCodeAt(base.length - tail))) tail--
    const a = base.slice(head, base.length - tail)
    const b = doc.slice(head, doc.length - tail)
    const parts = diffChars(a, b, { timeout: 150 }) ?? diffLines(a, b, { timeout: 300 })
    const out: Range<Decoration>[] = []
    if (!parts) {
        if (b) out.push(added.range(head, head + b.length))
        if (a && a.length <= MAX_REMOVED) out.push(Decoration.widget({ widget: new Removed(a), side: -1 }).range(head))
        return Decoration.set(out, true)
    }
    let pos = head
    for (const p of parts) {
        if (p.added) {
            out.push(added.range(pos, pos + p.value.length))
            pos += p.value.length
        } else if (p.removed) {
            out.push(Decoration.widget({ widget: new Removed(p.value), side: -1 }).range(pos))
        } else {
            pos += p.value.length
        }
    }
    return Decoration.set(out, true)
}

const plugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        timer: ReturnType<typeof setTimeout> | undefined
        constructor(readonly view: EditorView) {
            this.decorations = build(view.state.field(baseField), view.state.doc.toString())
        }
        update(u: ViewUpdate) {
            const baseChanged = u.startState.field(baseField) !== u.state.field(baseField)
            if (!u.docChanged && !baseChanged) return
            this.decorations = this.decorations.map(u.changes)
            clearTimeout(this.timer)
            this.timer = setTimeout(() => {
                this.decorations = build(this.view.state.field(baseField), this.view.state.doc.toString())
                this.view.dispatch({})
            }, baseChanged ? 0 : u.state.doc.length > LARGE ? 800 : 200)
        }
        destroy() {
            clearTimeout(this.timer)
        }
    },
    { decorations: (p) => p.decorations },
)

const theme = EditorView.baseTheme({
    '.cd-diff-add': { backgroundColor: 'rgba(56, 132, 255, 0.22)', borderRadius: '2px' },
    '.cd-diff-del': {
        backgroundColor: 'rgba(255, 72, 72, 0.22)',
        color: 'rgb(200, 40, 40)',
        textDecoration: 'line-through',
        borderRadius: '2px',
        whiteSpace: 'pre-wrap',
    },
    '&dark .cd-diff-del': { color: 'rgb(255, 130, 130)' },
})

export function diffHighlight(): Extension {
    return [baseField, plugin, theme]
}
