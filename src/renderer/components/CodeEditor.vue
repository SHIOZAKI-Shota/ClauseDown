<script setup lang="ts">
import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { startCompletion } from '@codemirror/autocomplete'
import { redo as cmRedo, redoDepth, undo as cmUndo, undoDepth } from '@codemirror/commands'
import type { LegalDoc } from '@shared/legal-parser'
import { legalExtensions, setLegalDoc } from '~/utils/legal-editor'
import { diffHighlight, setDiffBase } from '~/utils/diff-highlight'
import { searchPanel } from '~/utils/search-panel'

const props = withDefaults(
    defineProps<{
        modelValue: string
        legal: LegalDoc
        wrap?: boolean
        readonly?: boolean
        diffBase?: string | null
    }>(),
    { wrap: true, readonly: false, diffBase: null },
)
const wrapping = new Compartment()
const locking = new Compartment()
const lockExt = (on: boolean) => [EditorState.readOnly.of(on), EditorView.editable.of(!on)]
const emit = defineEmits<{
    'update:modelValue': [string]
    cursor: [number]
    scroll: [number]
    shortcut: ['article' | 'paragraph' | 'item']
    history: [{ undo: number; redo: number }]
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
                locking.of(lockExt(props.readonly)),
                EditorState.tabSize.of(2),
                ...legalExtensions(),
                diffHighlight(),
                searchPanel(),
                keymap.of([
                    { key: 'Mod-Alt-a', run: () => (emit('shortcut', 'article'), true) },
                    { key: 'Mod-Alt-p', run: () => (emit('shortcut', 'paragraph'), true) },
                    { key: 'Mod-Alt-i', run: () => (emit('shortcut', 'item'), true) },
                ]),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) queueEmit(u.state.doc.length)
                    if (u.docChanged || u.selectionSet) emit('cursor', u.state.doc.lineAt(u.state.selection.main.head).number - 1)
                    if (u.docChanged || u.transactions.length) emit('history', { undo: undoDepth(u.state), redo: redoDepth(u.state) })
                }),
                EditorView.domEventHandlers({
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
                    from: first.from, insert: `${indent}${open}
` },
                {
                    from: last.to, insert: `
${indent}${close}`
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
            from: first.from, insert: `${indent}${text}
` }, scrollIntoView: true
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

defineExpose({ focus, insertAfterLine, insertAtCursor, wrapLines, wrapInline, insertBeforeLines, selectionInfo, insertRef, currentLine, goToLine, undo, redo, selectedText, flush })
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
