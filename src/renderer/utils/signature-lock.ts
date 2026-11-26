import { EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, WidgetType, type DecorationSet } from '@codemirror/view'
import { layout, lockedSpans, locks, touches, type Locks, type Span } from '@shared/mdsig-layout'

interface LockInfo {
	locks: Locks
	spans: Span[]
	blocks: { from: number; to: number }[]
}

const cache = new WeakMap<Text, LockInfo>()

function lockInfo(doc: Text): LockInfo {
	const hit = cache.get(doc)
	if (hit) return hit
	const l = layout(doc.toString())
	const lk = locks(l)
	const n = doc.lines
	const at = (line: number) => doc.line(Math.min(Math.max(line, 1), n))
	const info: LockInfo = {
		locks: lk,
		spans: lockedSpans(
			lk,
			(line) => at(line).from,
			(line) => at(line).to,
			doc.length,
		),
		blocks: l.blocks.map((b) => ({ from: at(b.from).from, to: at(b.to).to })),
	}
	cache.set(doc, info)
	return info
}

const toggleFold = StateEffect.define<boolean>()

const folded = StateField.define<boolean>({
	create: () => true,
	update: (v, tr) => {
		for (const e of tr.effects) if (e.is(toggleFold)) return e.value
		return v
	},
})

class ChainWidget extends WidgetType {
	constructor(
		readonly count: number,
		readonly label: (n: number) => string,
	) {
		super()
	}
	override eq(o: ChainWidget) {
		return o.count === this.count
	}
	toDOM(view: EditorView) {
		const el = document.createElement('button')
		el.type = 'button'
		el.className = 'cm-sig-chain'
		el.textContent = this.label(this.count)
		el.onclick = () => view.dispatch({ effects: toggleFold.of(false) })
		return el
	}
	override ignoreEvent() {
		return false
	}
}

const LOCK_SVG =
	'<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'

class LockMarker extends GutterMarker {
	override toDOM() {
		const el = document.createElement('span')
		el.className = 'cm-sig-lock'
		el.innerHTML = LOCK_SVG
		return el
	}
}
const lockMarker = new LockMarker()

const lockGutter = gutter({
	class: 'cm-sig-gutter',
	lineMarker: (view, line) => {
		const info = lockInfo(view.state.doc)
		if (info.locks.kind === 'free') return null
		const chainFrom = info.blocks[0]?.from ?? Infinity
		if (line.from >= chainFrom) return null
		return touches(info.spans, line.from, line.to) ? lockMarker : null
	},
	lineMarkerChange: (u) => u.docChanged,
})

const lockedLine = Decoration.line({ class: 'cm-sig-locked' })
const blockLine = Decoration.line({ class: 'cm-sig-block' })

function decorations(state: EditorState, label: (n: number) => string): DecorationSet {
	const info = lockInfo(state.doc)
	const b = new RangeSetBuilder<Decoration>()
	if (info.locks.kind === 'free') return b.finish()
	const chainFrom = info.blocks[0]?.from ?? state.doc.length
	const chainTo = info.blocks.at(-1)?.to ?? state.doc.length
	const lockedLines = new Set<number>()
	for (const s of info.spans) {
		const a = state.doc.lineAt(Math.min(s.from, state.doc.length)).number
		const z = state.doc.lineAt(Math.min(Math.max(s.to, s.from), state.doc.length)).number
		for (let l = a; l <= z; l++) lockedLines.add(l)
	}
	const fold = state.field(folded)
	for (let l = 1; l <= state.doc.lines; l++) {
		const line = state.doc.line(l)
		if (line.from >= chainFrom && line.from <= chainTo) {
			if (fold) {
				if (line.from === chainFrom) b.add(chainFrom, chainTo, Decoration.replace({ widget: new ChainWidget(info.blocks.length, label), block: true }))
				continue
			}
			b.add(line.from, line.from, blockLine)
		} else if (lockedLines.has(l)) b.add(line.from, line.from, lockedLine)
	}
	return b.finish()
}

export function signatureLock(onBlocked: () => void, label: (n: number) => string): Extension {
	const deco = StateField.define<DecorationSet>({
		create: (s) => decorations(s, label),
		update: (v, tr) => (tr.docChanged || tr.effects.some((e) => e.is(toggleFold)) ? decorations(tr.state, label) : v),
		provide: (f) => EditorView.decorations.from(f),
	})
	return [
		folded,
		deco,
		lockGutter,
		EditorState.changeFilter.of((tr) => {
			if (!tr.docChanged) return true
			const { spans, locks: lk } = lockInfo(tr.startState.doc)
			if (lk.kind === 'free') return true
			let blocked = false
			tr.changes.iterChangedRanges((a, b) => {
				if (touches(spans, a, b)) blocked = true
			})
			if (blocked) queueMicrotask(onBlocked)
			return !blocked
		}),
		EditorView.baseTheme({
			'.cm-sig-locked': { backgroundColor: 'color-mix(in oklab, var(--ui-color-primary-500) 6%, transparent)' },
			'.cm-sig-block': { color: 'var(--ui-text-muted)' },
			'.cm-sig-gutter': { width: '14px' },
			'.cm-sig-lock': { display: 'inline-flex', paddingTop: '4px', color: 'var(--ui-text-muted)' },
			'.cm-sig-chain': {
				display: 'inline-block',
				margin: '4px 0',
				padding: '1px 8px',
				border: '1px solid var(--ui-border)',
				borderRadius: '4px',
				font: 'inherit',
				fontSize: '12px',
				color: 'var(--ui-text-muted)',
				background: 'var(--ui-bg-elevated)',
				cursor: 'pointer',
			},
		}),
	]
}
