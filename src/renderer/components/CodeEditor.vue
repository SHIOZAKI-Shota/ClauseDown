<script setup lang="ts">
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { forEachDiagnostic } from '@codemirror/lint'
import { markdown } from '@codemirror/lang-markdown'
import { startCompletion } from '@codemirror/autocomplete'
import { redo as cmRedo, redoDepth, undo as cmUndo, undoDepth } from '@codemirror/commands'
import type { LegalDoc } from '@shared/legal-parser'
import { legalExtensions, proofreadLinter, setLegalDoc } from '~/utils/legal-editor'
import { diffHighlight, setDiffBase } from '~/utils/diff-highlight'
import { searchPanel } from '~/utils/search-panel'
import type { EditorIssue } from '~/components/IssuePane.vue'

const props = withDefaults(
    defineProps<{
        modelValue: string
        legal: LegalDoc
        wrap?: boolean
        proofread?: boolean
        readonly?: boolean
        diffBase?: string | null
    }>(),
    { wrap: true, readonly: false, diffBase: null, proofread: true },
)
const wrapping = new Compartment()
const proofreading = new Compartment()
const proofreadExt = proofreadLinter((text) => window.api.proofread(text))
const locking = new Compartment()
const lockExt = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)]
const emit = defineEmits<{
    'update:modelValue': [string]
    cursor: [number]
    scroll: [number]
    shortcut: ['article' | 'paragraph' | 'item']
    history: [{ undo: number; redo: number }]
    images: [File[]]
    issues: [EditorIssue[]]
    openIssues: []
}>()
const host = ref<HTMLDivElement>()
let view: EditorView | null = null

onMounted(() => {
    view = new EditorView({
        parent: host.value!,
        state: EditorState.create({
            doc: props.modelValue,
            extensions: [
                basicSetup,
                markdown(),
                wrapping.of(props.wrap ? EditorView.lineWrapping : []),
                proofreading.of(props.proofread ? proofreadExt : []),
                locking.of(lockExt(props.readonly)),
                EditorState.tabSize.of(2),
                ...legalExtensions(),
                diffHighlight(),
                searchPanel(),
                Prec.highest(keymap.of([{ key: 'Mod-Shift-m', run: () => (emit('openIssues'), true) }])),
                keymap.of([
                    { key: 'Mod-Alt-a', run: () => (emit('shortcut', 'article'), true) },
                    { key: 'Mod-Alt-p', run: () => (emit('shortcut', 'paragraph'), true) },
                    { key: 'Mod-Alt-i', run: () => (emit('shortcut', 'item'), true) },
                ]),
                EditorView.updateListener.of((u) => {
                    emitIssues(u.state)
                    if (u.docChanged) queueEmit(u.state.doc.length)
                    if (u.docChanged || u.selectionSet) emit('cursor', u.state.doc.lineAt(u.state.selection.main.head).number - 1)
                    if (u.docChanged || u.transactions.length) emit('history', { undo: undoDepth(u.state), redo: redoDepth(u.state) })
                }),
                EditorView.domEventHandlers({
                    paste: (e) => {
                        const files = imageFiles(e.clipboardData)
                        if (!files.length || props.readonly || e.clipboardData?.getData('text/plain')) return false
                        e.preventDefault()
                        emit('images', files)
                        return true
                    },
                    drop: (e, v) => {
                        const files = imageFiles(e.dataTransfer)
                        if (!files.length || props.readonly) return false
                        e.preventDefault()
                        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
                        if (pos !== null) v.dispatch({ selection: { anchor: pos } })
                        emit('images', files)
                        return true
                    },
                    scroll: (_e, v) => {
                        if (scrollFrame) return
                        scrollFrame = requestAnimationFrame(() => {
                            scrollFrame = 0
                            const top = v.lineBlockAtHeight(v.scrollDOM.scrollTop)
                            const line = v.state.doc.lineAt(top.from).number - 1
                            if (line !== lastScrollLine) emit('scroll', (lastScrollLine = line))
                        })
                    },
                }),
            ],
        }),
    })
    view.dispatch({ effects: [setLegalDoc.of(props.legal), setDiffBase.of(props.diffBase)] })
})

let scrollFrame = 0
let lastScrollLine = -1
let lastEmitted: string | null = null
const LARGE = 200_000
let emitTimer: ReturnType<typeof setTimeout> | undefined
function queueEmit(length: number) {
    clearTimeout(emitTimer)
    emitTimer = undefined
    if (length > LARGE) emitTimer = setTimeout(flush, 150)
    else if (view) emit('update:modelValue', (lastEmitted = view.state.doc.toString()))
}
function flush() {
    if (emitTimer === undefined) return
    clearTimeout(emitTimer)
    emitTimer = undefined
    if (view) emit('update:modelValue', (lastEmitted = view.state.doc.toString()))
}
watch(
    () => props.modelValue,
    (v) => {
        if (view && v !== lastEmitted && v !== view.state.doc.toString()) {
            lastEmitted = v
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
            clearTimeout(emitTimer)
            emitTimer = undefined
        }
    },
)
watch(
    () => props.wrap,
    (w) => view?.dispatch({ effects: wrapping.reconfigure(w ? EditorView.lineWrapping : []) }),
)
watch(
    () => props.proofread,
    (on) => view?.dispatch({ effects: proofreading.reconfigure(on ? proofreadExt : []) }),
)
watch(
    () => props.readonly,
    (on) => view?.dispatch({ effects: locking.reconfigure(lockExt(on)) }),
)
watch(
    () => props.legal,
    (ld) => view?.dispatch({ effects: setLegalDoc.of(ld) }),
)
watch(
    () => props.diffBase,
    (b) => view?.dispatch({ effects: setDiffBase.of(b) }),
)

onBeforeUnmount(() => {
    flush()
    cancelAnimationFrame(scrollFrame)
    view?.destroy()
})

function insertAfterLine(text: string, cursorOffset = text.length) {
    if (!view) return
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const insert = '\n' + text
    view.dispatch({
        changes: { from: line.to, insert },
        selection: { anchor: line.to + 1 + cursorOffset },
        scrollIntoView: true,
    })
    view.focus()
}

const imageFiles = (dt: DataTransfer | null) => [...(dt?.files ?? [])].filter((f) => f.type.startsWith('image/'))

function insertBlock(text: string) {
    if (!view) return
    const doc = view.state.doc
    const cur = doc.lineAt(view.state.selection.main.head)
    let ref = cur
    while (!ref.text.trim() && ref.number > 1) ref = doc.line(ref.number - 1)
    const m = /^(\s*)([-*+]\s+)?/.exec(ref.text)!
    const indent = ' '.repeat(m[1].length + (m[2]?.length ?? 0))
    const blank = !cur.text.trim()
    const insert = blank ? `${indent}${text}` : `\n${indent}${text}`
    view.dispatch({
        changes: { from: blank ? cur.from : cur.to, to: cur.to, insert },
        selection: { anchor: (blank ? cur.from : cur.to) + insert.length },
        scrollIntoView: true,
    })
    view.focus()
}

let lastIssues = ''
function collectIssues(state: EditorState): EditorIssue[] {
    const out: EditorIssue[] = []
    forEachDiagnostic(state, (d, from, to) =>
        out.push({
            from,
            to,
            line: state.doc.lineAt(from).number - 1,
            severity: d.severity === 'error' ? 'error' : 'warning',
            message: d.message,
            ...(d.source ? { source: d.source } : {}),
        }),
    )
    return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

function emitIssues(state: EditorState) {
    const list = collectIssues(state)
    const key = list.map((i) => `${i.from}:${i.to}:${i.severity}:${i.message}`).join('|')
    if (key === lastIssues) return
    lastIssues = key
    emit('issues', list)
}

function selectIssue(it: { from: number; to: number }) {
    if (!view) return
    view.dispatch({ selection: { anchor: it.from, head: it.to }, scrollIntoView: true })
    view.focus()
}

function nextIssue(kind: 'error' | 'warning', dir: 1 | -1 = 1): EditorIssue | null {
    if (!view) return null
    const found = collectIssues(view.state).filter((d) => d.severity === kind)
    if (!found.length) return null
    const head = view.state.selection.main.from
    const next = dir > 0 ? (found.find((d) => d.from > head) ?? found[0]) : (found.findLast((d) => d.from < head) ?? found[found.length - 1])
    selectIssue(next)
    return next
}

function insertClause(afterLine: number, block: string, lineEdits: { line: number; text: string }[]) {
    if (!view) return
    const doc = view.state.doc
    const at = doc.line(Math.min(Math.max(afterLine, 0) + 1, doc.lines)).to
    const changes = view.state.changes([
        ...lineEdits
            .filter((e) => e.line + 1 <= doc.lines)
            .map((e) => {
                const l = doc.line(e.line + 1)
                return { from: l.from, to: l.to, insert: e.text }
            }),
        { from: at, insert: `\n\n${block}` },
    ])
    view.dispatch({ changes, selection: { anchor: changes.mapPos(at, -1) + 2 }, scrollIntoView: true })
    view.focus()
}

function insertAfterBullet(text: string, cursorOffset = text.length) {
    if (!view) return
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const m = /^\s*[-*+]\s+/.exec(line.text)
    const at = m ? line.from + m[0].length : view.state.selection.main.head
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + cursorOffset }, scrollIntoView: true })
    view.focus()
}

function insertPreamble() {
    if (!view) return
    const doc = view.state.doc
    let at = doc.length
    for (let n = 1; n <= doc.lines; n++) {
        const l = doc.line(n)
        if (/^##\s/.test(l.text)) {
            at = l.from
            break
        }
    }
    view.dispatch({ changes: { from: at, insert: '\n\n' }, selection: { anchor: at === doc.length ? at + 1 : at }, scrollIntoView: true })
    view.focus()
}

function insertAtCursor(text: string, cursorOffset = text.length) {
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + cursorOffset }, scrollIntoView: true })
    view.focus()
}

function wrapLines(open: string, close: string, cursorInOpen: number) {
    if (!view) return
    const { from, to } = view.state.selection.main
    const first = view.state.doc.lineAt(from)
    const last = view.state.doc.lineAt(to > from && view.state.doc.lineAt(to).from === to ? to - 1 : to)
    const indent = /^\s*/.exec(first.text)![0]
    if (from === to) {
        const insert = `
${indent}${open}
${indent}
${indent}${close}`
        view.dispatch({ changes: { from: first.to, insert }, selection: { anchor: first.to + 1 + indent.length + cursorInOpen }, scrollIntoView: true })
    } else {
        view.dispatch({
            changes: [
                {
                    from: first.from,
                    insert: `${indent}${open}
`,
                },
                {
                    from: last.to,
                    insert: `
${indent}${close}`,
                },
            ],
            selection: { anchor: first.from + indent.length + cursorInOpen },
            scrollIntoView: true,
        })
    }
    view.focus()
}

function selectionInfo(): { text: string; inline: boolean; empty: boolean } {
    if (!view) return { text: '', inline: false, empty: true }
    const { from, to } = view.state.selection.main
    const first = view.state.doc.lineAt(from)
    const last = view.state.doc.lineAt(to)
    const text = view.state.sliceDoc(from, to)
    const inline = from !== to && first.number === last.number && text.trim() !== first.text.trim()
    return { text: from === to ? first.text : text, inline, empty: from === to }
}

function wrapInline(open: string, close: string) {
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({
        changes: [
            { from, insert: open },
            { from: to, insert: close },
        ],
        selection: { anchor: from + open.length, head: to + open.length },
        scrollIntoView: true,
    })
    view.focus()
}

function insertBeforeLines(text: string) {
    if (!view) return
    const first = view.state.doc.lineAt(view.state.selection.main.from)
    const indent = /^\s*/.exec(first.text)![0]
    view.dispatch({
        changes: {
            from: first.from,
            insert: `${indent}${text}
`,
        },
        scrollIntoView: true,
    })
    view.focus()
}

function insertRef() {
    insertAtCursor('[[')
    if (view) startCompletion(view)
}

function currentLine(): string {
    if (!view) return ''
    return view.state.doc.lineAt(view.state.selection.main.head).text
}

function goToLine(n: number) {
    if (!view) return
    const line = view.state.doc.line(Math.min(Math.max(n + 1, 1), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }) })
    view.focus()
}

function undo() {
    if (view) cmUndo(view)
    view?.focus()
}
function redo() {
    if (view) cmRedo(view)
    view?.focus()
}

function selectedText(): string {
    if (!view) return ''
    const { from, to } = view.state.selection.main
    return view.state.sliceDoc(from, to)
}

function focus() {
    view?.focus()
}

defineExpose({
    focus,
    nextIssue,
    selectIssue,
    insertAfterLine,
    insertAtCursor,
    insertBlock,
    insertClause,
    insertAfterBullet,
    insertPreamble,
    wrapLines,
    wrapInline,
    insertBeforeLines,
    selectionInfo,
    insertRef,
    currentLine,
    goToLine,
    undo,
    redo,
    selectedText,
    flush,
})
</script>

<template>
    <div ref="host" class="cm-host" />
</template>

<style scoped>
.cm-host {
    height: 100%;
    overflow: hidden;
    background: var(--cd-ed-bg);
}
</style>
