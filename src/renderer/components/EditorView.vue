<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { parseLegal, articleTitle } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { autoMerge } from '@shared/merge3'
import { DEFAULT_CONFIG, readConfig, writeConfig, type DocConfig } from '@shared/config'
import { extOfMime } from '@shared/images'
import { clauseInsertLine, type ClauseInsert } from '@shared/clauses'
import { backRefs } from '@shared/doc-view'
import { isEnabled } from '@shared/experiments'
import { spellLang } from '@shared/legal-styles'
import { docTemplates } from '@shared/doc-templates'
import { useApp } from '~/stores/app'
import { lastAtOrBefore, positionLabel } from '~/utils/legal-editor'
import { toPlain } from '~/utils/ipc'
import { useStoredRef } from '~/composables/useStoredRef'
import { useT } from '~/composables/useT'
import { useArticleTrail } from '~/composables/useArticleTrail'
import { useElementSize } from '@vueuse/core'
import { usePane, paneStyle, type Pane } from '~/composables/usePane'
import CodeEditor from '~/components/CodeEditor.vue'
import type { EditorIssue } from '~/components/IssuePane.vue'
import type PdfPagesView from '~/components/PdfPages.vue'
import type { SaveRequest } from '~/components/SaveVersionModal.vue'
import type { SealInsert } from '~/components/SealModal.vue'
import { usePdfSign } from '~/composables/usePdfSign'

const app = useApp()
const t = useT()
const path = app.currentPath!
const text = ref('')
const loaded = ref(false)
const editor = ref<InstanceType<typeof CodeEditor>>()
const preview = ref<HTMLDivElement>()
const showConfig = ref(false)
const showSave = ref(false)
const newDoc = ref(false)
const saving = ref<'idle' | 'pending' | 'saved'>('idle')
const confirmDiscard = ref(false)
const cursorLine = ref(0)
const history = ref({ undo: 0, redo: 0 })

const layout = useStoredRef('clausedown.editorLayout', { mode: 'split' as 'split' | 'edit' | 'preview', ai: false })

const outlinePane = usePane('outline', { size: 230, min: 160, max: 480, collapsed: isDemo() })
const aiPane = usePane('ai', { size: 360, min: 280, max: 760 })
const editBase = usePane('edit', { size: 0, min: 260, max: 2400 })
const editPane: Pane = { ...editBase, collapse: () => (layout.value.mode = 'preview'), expand: () => (layout.value.mode = 'split') }
const previewPane: Pane = {
    ...editBase,
    grow: (s) => editBase.shrink(s),
    shrink: (s) => editBase.grow(s),
    collapse: () => (layout.value.mode = 'edit'),
    expand: () => (layout.value.mode = 'split'),
}
const editCol = ref<HTMLDivElement>()
const toolbar = ref<HTMLDivElement>()
const { width: toolbarWidth } = useElementSize(toolbar)
const compact = computed(() => toolbarWidth.value > 0 && toolbarWidth.value < 1150)
editBase.measure.value = () => editCol.value?.offsetWidth ?? 0

const body = ref<HTMLDivElement>()
const { width: bodyWidth } = useElementSize(body)
const PREVIEW_MIN = 420
const squeezed = computed(() => {
    if (layout.value.mode !== 'split' || !layout.value.ai || aiPane.state.value.collapsed || !bodyWidth.value) return false
    const outline = outlinePane.state.value.collapsed ? 40 : outlinePane.state.value.size || outlinePane.opts.min
    const ai = aiPane.state.value.size || aiPane.opts.min
    return bodyWidth.value - outline - ai - editBase.opts.min < PREVIEW_MIN
})
const mode = computed(() => (squeezed.value ? 'edit' : layout.value.mode))
const previewRail = computed<Pane>(() => (squeezed.value ? { ...previewPane, expand: () => aiPane.collapse() } : previewPane))
const editStyle = computed(() => (mode.value === 'split' ? paneStyle(editBase) : { flex: '1 1 0' }))

const settled = ref('')
let parseTimer: ReturnType<typeof setTimeout> | undefined
watch(text, (v) => {
    clearTimeout(parseTimer)
    parseTimer = setTimeout(() => (settled.value = v), v.length > 200_000 ? 500 : 120)
})
const doc = computed(() => parseLegal(settled.value))
const backs = computed(() => backRefs(settled.value, doc.value))
const countArticles = (d: typeof doc.value) => d.chapters.reduce((n, ch) => n + ch.articles.length, 0)
let referenced = new Map<string, string>()
watch(doc, (d, old) => {
    if (old && countArticles(d) < countArticles(old)) {
        const lost = [...referenced].filter(([id]) => !d.refs[id] && settled.value.includes(`[[${id}`))
        if (lost.length) app.notify(t.value.editor.lostRefs(lost.map(([, label]) => label).join(t.value.editor.listSep)), true)
    }
    referenced = new Map(Object.entries(d.refs).flatMap(([id, a]) => (backs.value.has(a.line) ? [[id, a.refLabel] as [string, string]] : [])))
})
const printKind = computed({
    get: () => app.prefs.previewKind ?? 'normal',
    set: (v: 'normal' | 'print') => app.setPrefsLive({ previewKind: v }),
})
const PREVIEW_KINDS = computed(() => [
    { value: 'normal' as const, label: t.value.editor.previewKinds.normal, icon: 'i-lucide-scroll-text' },
    { value: 'print' as const, label: t.value.editor.previewKinds.print, icon: 'i-lucide-printer' },
])
const demo = isDemo()
const showPrint = computed(() => !demo && mode.value !== 'edit' && printKind.value === 'print')
const html = computed(() => (mode.value === 'edit' || showPrint.value ? '' : withImages(renderDoc(doc.value), app.repoDir, path)))
const pdfData = shallowRef<Uint8Array | null>(null)
const PdfPages = defineAsyncComponent(() => import('~/components/PdfPages.vue'))
const pdfPages = ref<InstanceType<typeof PdfPagesView>>()
const pdfBusy = ref(false)
const pdfError = ref('')
let pdfSeq = 0
let pdfTimer: ReturnType<typeof setTimeout> | undefined
async function makePdf() {
    const n = ++pdfSeq
    pdfBusy.value = true
    try {
        const bytes = await window.api.previewPdf(settled.value, toPlain(app.style), { dir: app.repoDir!, docPath: path })
        if (n !== pdfSeq) return
        pdfData.value = bytes
        pdfError.value = ''
    } catch (e) {
        if (n === pdfSeq) pdfError.value = (e as Error).message
    } finally {
        if (n === pdfSeq) pdfBusy.value = false
    }
}
watch(
    () => [showPrint.value, settled.value, app.style] as const,
    ([on]) => {
        clearTimeout(pdfTimer)
        if (on && loaded.value) pdfTimer = setTimeout(() => void makePdf(), pdfData.value ? 900 : 0)
    },
    { deep: true },
)
watch(loaded, (v) => v && showPrint.value && void makePdf())
onBeforeUnmount(() => clearTimeout(pdfTimer))

const savedText = ref<string | null>(null)
async function loadSaved() {
    savedText.value = await window.api.readAt(app.repoDir!, 'HEAD', path)
}

onMounted(async () => {
    const [content] = await Promise.all([window.api.readDoc(app.repoDir!, path), loadSaved()])
    lastWritten = content
    text.value = content
    settled.value = content
    loaded.value = true
})

watch(
    () => [loaded.value, app.jumpTo] as const,
    async ([ready, target]) => {
        if (!ready || !target || target.path !== path) return
        app.jumpTo = null
        await nextTick()
        setTimeout(() => editor.value?.goToLine(target.line), 50)
    },
    { immediate: true },
)

let timer: ReturnType<typeof setTimeout> | undefined
let lastWritten = ''
watch(text, (v) => {
    if (!loaded.value || v === lastWritten) return
    saving.value = 'pending'
    clearTimeout(timer)
    timer = setTimeout(() => writeNow(), 500)
})

let writing: Promise<void> = Promise.resolve()
function writeNow(): Promise<void> {
    editor.value?.flush()
    clearTimeout(timer)
    writing = writing
        .then(async () => {
            const v = text.value
            if (v !== lastWritten) {
                await window.api.writeDoc(app.repoDir!, path, v)
                lastWritten = v
                app.markChanged(path)
            }
            if (text.value === lastWritten) saving.value = 'saved'
        })
        .catch((e) => {
            saving.value = 'pending'
            app.notify(t.value.editor.saveFailed((e as Error).message), true)
        })
    return writing
}

app.setEditorFlush(writeNow)

onBeforeUnmount(() => {
    app.setEditorFlush(null)
    void writeNow()
})

const indentOf = () => /^(\s*)/.exec(editor.value?.currentLine() ?? '')![1].length
function addChapter() {
    editor.value?.insertAfterLine('\n## ', 4)
}
function addArticle() {
    editor.value?.insertAfterLine('\n### \n- ', 5)
}
function addBranchArticle() {
    editor.value?.insertAfterLine('\n###  {branch}\n- ', 5)
}
function addDeletedArticle() {
    editor.value?.insertAfterLine('\n### {deleted}\n')
}
function addNumberedArticle() {
    editor.value?.insertAfterLine('\n###  {n=}\n- ', 9)
}
function addItemNumber() {
    editor.value?.insertAfterBullet('{n=} ', 3)
}
function addItemBranch() {
    editor.value?.insertAfterBullet('{b=} ', 3)
}
function addPreamble() {
    editor.value?.insertPreamble()
}
const tpl = () => docTemplates(doc.value.lang)
function addSupplement() {
    const { body, cursor } = tpl().supplement
    editor.value?.insertAfterLine(body, body.indexOf(cursor))
}
function addClosing() {
    const { body, cursor } = tpl().closing
    editor.value?.insertAfterLine(body, body.indexOf(cursor))
}
function addParagraph() {
    editor.value?.insertAfterLine('- ')
}
function addItem() {
    const indent = indentOf()
    editor.value?.insertAfterLine(indent >= 2 ? `${' '.repeat(indent)}- ` : '  - ')
}
function addSubitem() {
    editor.value?.insertAfterLine(`${' '.repeat(Math.max(indentOf() + 2, 4))}- `)
}
function blockIndent() {
    const line = editor.value?.currentLine() ?? ''
    return /^\s*[-*+]\s/.test(line) ? ' '.repeat(indentOf() + 2) : ''
}
function addTable() {
    const i = blockIndent()
    const body = tpl()
        .table.map((l) => i + l)
        .join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + i.length + 2)
}
function addInlineMath() {
    editor.value?.wrapInline('$', '$')
}
function addMathBlock() {
    const i = blockIndent()
    const body = ['```math', tpl().math, '```'].map((l) => i + l).join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + i.length + 8)
}
function addFigure() {
    const i = blockIndent()
    const body = ['```mermaid', 'flowchart LR', ...tpl().flow, '```'].map((l) => i + l).join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + body.indexOf('A['))
}
async function addImages(files: File[]) {
    for (const f of files) {
        const data = new Uint8Array(await f.arrayBuffer())
        const saved = await app.run(() => window.api.saveImage(app.repoDir!, path, data, extOfMime(f.type) ?? 'png'))
        if (saved) editor.value?.insertBlock(`![${tpl().figure}](${saved.src})`)
    }
}
function pickImages() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp'
    input.multiple = true
    input.onchange = () => void addImages([...(input.files ?? [])])
    input.click()
}
function addAppendix() {
    const { appendix, table } = tpl()
    editor.value?.insertAfterLine(`\n## ${appendix} {appendix}\n${table.join('\n')}\n`, 4)
}
const pdfSign = usePdfSign()
const sealOpen = ref(false)
const CLOSING_RE = /^##\s.*\{[^}]*\bclosing\b[^}]*\}/
function inClosing(): boolean {
    const lines = text.value.split('\n').slice(0, (editor.value?.cursorLineIndex() ?? 0) + 1)
    for (let i = lines.length - 1; i >= 0; i--) {
        if (/^##\s/.test(lines[i])) return CLOSING_RE.test(lines[i])
    }
    return false
}
function closingEnd(): number | null {
    const lines = text.value.split('\n')
    const start = lines.findIndex((l) => CLOSING_RE.test(l))
    if (start < 0) return null
    let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
    if (end < 0) end = lines.length
    while (end - 1 > start && !lines[end - 1].trim()) end--
    return end - 1
}
async function insertSeal(s: SealInsert) {
    if (!app.repoDir) return
    const saved = await app.run(() => window.api.saveImage(app.repoDir!, path, s.png, 'png'))
    if (!saved) return
    const size = s.size && s.size !== (s.mark === 'sign' ? 12 : 15) ? `=${s.size}mm` : ''
    const mark = `![${s.label.replace(/[[\]]/g, '')}](${saved.src}){${s.mark ?? 'seal'}${size}}`
    if (!inClosing() && confirm(t.value.signing.sealModal.outsideClosing)) {
        const end = closingEnd()
        if (end === null) {
            editor.value?.goToLine(text.value.split('\n').length - 1)
            addClosing()
        } else editor.value?.goToLine(end)
        editor.value?.insertBlock(mark)
        return
    }
    const line = editor.value?.currentLine() ?? ''
    editor.value?.insertAtCursor(line.trim() ? ` ${mark}` : mark)
}
function addPageBreak() {
    editor.value?.insertBeforeLines('{break}')
}
const propFor = ref<{ sample: string; inline: boolean } | null>(null)
function addFormat() {
    const s = editor.value?.selectionInfo()
    if (s) propFor.value = { sample: s.text, inline: s.inline }
}
function applyProp(r: { open: string; close: string; mode: 'inline' | 'lines'; onlyBreak: boolean }) {
    propFor.value = null
    if (r.onlyBreak) editor.value?.insertBeforeLines(r.open)
    else if (r.mode === 'inline') editor.value?.wrapInline(r.open, r.close)
    else editor.value?.wrapLines(r.open, r.close, r.open.length)
}
const selEmpty = ref(true)
function onEditorMenu() {
    selEmpty.value = editor.value?.selectionInfo().empty ?? true
}
async function editCommand(cmd: 'cut' | 'copy' | 'paste') {
    editor.value?.focus()
    await nextTick()
    await window.api.editCommand(cmd)
}
const editMenu = computed<DropdownMenuItem[][]>(() => {
    const m = t.value.editor.context
    return [
        [
            { label: m.cut, icon: 'i-lucide-scissors', kbds: ['meta', 'x'], disabled: selEmpty.value, onSelect: () => editCommand('cut') },
            { label: m.copy, icon: 'i-lucide-copy', kbds: ['meta', 'c'], disabled: selEmpty.value, onSelect: () => editCommand('copy') },
            { label: m.paste, icon: 'i-lucide-clipboard', kbds: ['meta', 'v'], onSelect: () => editCommand('paste') },
        ],
        [
            { label: selEmpty.value ? m.formatLine : m.formatSelection, icon: 'i-lucide-type', onSelect: addFormat },
            { label: m.pageBreakBefore, icon: 'i-lucide-separator-horizontal', onSelect: addPageBreak },
        ],
        [{ label: m.insertRef, icon: 'i-lucide-link', onSelect: () => editor.value?.insertRef() }, backRefItem.value],
        [{ label: articleHere() ? m.issueArticle : m.issueDoc, icon: 'i-lucide-list-todo', onSelect: issueHere }],
    ]
})
const backRefItem = computed<DropdownMenuItem>(() => {
    let line = -1
    for (const ch of doc.value.chapters) for (const a of ch.articles) if (a.line >= 0 && a.line <= cursorLine.value) line = a.line
    const list = backs.value.get(line) ?? []
    return list.length
        ? {
              label: t.value.editor.context.backRefs(list.length),
              icon: 'i-lucide-corner-up-left',
              children: list.map((b) => ({ label: b.label, onSelect: () => editor.value?.goToLine(b.line) })),
          }
        : { label: t.value.editor.context.noBackRefs, icon: 'i-lucide-corner-up-left', disabled: true }
})
function articleHere() {
    let hit: { label: string; title: string } | null = null
    for (const ch of doc.value.chapters)
        for (const a of ch.articles) if (!a.deleted && a.line >= 0 && a.line <= cursorLine.value) hit = { label: a.label, title: articleTitle(a, doc.value) }
    return hit
}
function issueHere() {
    const name = app.docs.find((d) => d.path === path)?.title ?? path
    const a = articleHere()
    const where = a ? `${name} ${a.label}${a.title ? `（${a.title}）` : ''}` : name
    app.openIssues({ draft: { title: '', body: where } })
}
const issueList = shallowRef<EditorIssue[]>([])
const issues = computed(() => {
    const errors = issueList.value.filter((i) => i.severity === 'error').length
    return { errors, warnings: issueList.value.length - errors }
})
const issuesOpen = useStoredRef('clausedown.issues.open', false)
const issueFilter = ref<'all' | 'error' | 'warning'>('all')
const activeIssue = ref<number | null>(null)
const issueNote = ref<{ kind: 'error' | 'warning'; text: string } | null>(null)
let issueTimer: ReturnType<typeof setTimeout> | undefined
const ISSUE_KINDS = [
    { kind: 'error', count: 'errors', icon: 'i-lucide-circle-x', color: 'error' },
    { kind: 'warning', count: 'warnings', icon: 'i-lucide-triangle-alert', color: 'warning' },
] as const
function noteIssue(it: EditorIssue | null | undefined) {
    clearTimeout(issueTimer)
    activeIssue.value = it?.from ?? null
    issueNote.value = it ? { kind: it.severity, text: it.message } : null
    if (it) issueTimer = setTimeout(() => (issueNote.value = null), 10_000)
}
function goIssue(kind: 'error' | 'warning', dir: 1 | -1) {
    noteIssue(editor.value?.nextIssue(kind, dir))
}
function pickIssue(it: EditorIssue) {
    editor.value?.selectIssue(it)
    noteIssue(it)
}
function toggleIssues(kind: 'all' | 'error' | 'warning') {
    if (issuesOpen.value && issueFilter.value === kind) issuesOpen.value = false
    else {
        issueFilter.value = kind
        issuesOpen.value = true
    }
}
watch(text, () => (issueNote.value = null))
const showClauses = ref(false)
const clauseLibrary = computed(() =>
    isEnabled(app.settings, 'clauseLibrary') ? (app.settings?.repos.find((r) => r.dir === app.settings?.clauseLibrary) ?? null) : null,
)
function openClauses() {
    if (!clauseLibrary.value) return app.notify(t.value.editor.clauseLibraryMissing, true)
    showClauses.value = true
}
function insertClause(r: ClauseInsert) {
    showClauses.value = false
    const lines = text.value.replace(/\r\n/g, '\n').split('\n')
    editor.value?.insertClause(clauseInsertLine(doc.value, lines, cursorLine.value), r.block, r.lineEdits)
}
function backToEditor(e: Event) {
    e.preventDefault()
    editor.value?.focus()
}
const insertMenu = computed<DropdownMenuItem[][]>(() => {
    const m = t.value.editor.insert
    return [
        [
            { label: m.chapter, icon: 'i-lucide-heading-2', onSelect: addChapter },
            {
                label: m.article,
                icon: 'i-lucide-heading-3',
                children: [
                    { label: m.article, kbds: ['meta', 'alt', 'a'], onSelect: addArticle },
                    { label: m.branchArticle, onSelect: addBranchArticle },
                    { label: m.deletedArticle, onSelect: addDeletedArticle },
                    { label: m.numberedArticle, onSelect: addNumberedArticle },
                ],
            },
            {
                label: m.paraItem,
                icon: 'i-lucide-list',
                children: [
                    { label: m.paragraph, kbds: ['meta', 'alt', 'p'], onSelect: addParagraph },
                    { label: m.item, kbds: ['meta', 'alt', 'i'], onSelect: addItem },
                    { label: m.subitem, onSelect: addSubitem },
                    { label: m.itemNumber, onSelect: addItemNumber },
                    { label: m.itemBranch, onSelect: addItemBranch },
                ],
            },
        ],
        [
            { label: m.preamble, icon: 'i-lucide-pilcrow', onSelect: addPreamble },
            { label: m.supplement, icon: 'i-lucide-book-plus', onSelect: addSupplement },
            { label: m.closing, icon: 'i-lucide-pen-line', onSelect: addClosing },
            { label: m.seal, icon: 'i-lucide-stamp', onSelect: () => (sealOpen.value = true) },
            { label: m.appendix, icon: 'i-lucide-sheet', onSelect: addAppendix },
        ],
        [
            {
                label: m.table,
                icon: 'i-lucide-table',
                children: [
                    { label: m.table, onSelect: addTable },
                    { label: m.mergeRight, onSelect: () => editor.value?.insertAtCursor('>') },
                    { label: m.mergeUp, onSelect: () => editor.value?.insertAtCursor('^') },
                ],
            },
            { label: m.figure, icon: 'i-lucide-workflow', onSelect: addFigure },
            {
                label: m.math,
                icon: 'i-lucide-sigma',
                children: [
                    { label: m.inlineMath, onSelect: addInlineMath },
                    { label: m.displayMath, onSelect: addMathBlock },
                ],
            },
            { label: m.image, icon: 'i-lucide-image', onSelect: pickImages },
            { label: m.ref, icon: 'i-lucide-link', kbds: ['[', '['], onSelect: () => editor.value?.insertRef() },
        ],
        [
            { label: m.pageBreak, icon: 'i-lucide-separator-horizontal', onSelect: addPageBreak },
            { label: m.format, icon: 'i-lucide-type', onSelect: addFormat },
        ],
        ...(isEnabled(app.settings, 'clauseLibrary') ? [[{ label: m.clauseLibrary, icon: 'i-lucide-library', onSelect: openClauses }]] : []),
    ]
})
function onShortcut(kind: 'article' | 'paragraph' | 'item') {
    if (kind === 'article') addArticle()
    else if (kind === 'paragraph') addParagraph()
    else addItem()
}

function changeConfig(c: DocConfig) {
    editor.value?.flush()
    text.value = writeConfig(text.value, c)
}
function preset(kind: 'law' | 'contract') {
    const doc = { ...readConfig(text.value).config.doc }
    if (kind === 'law') return changeConfig({ ...structuredClone(DEFAULT_CONFIG), doc })
    changeConfig({
        doc,
        chapter: { numeral: 'arabic' },
        article: { numeral: 'arabic', title: 'inline', numbering: 'continuous' },
        paragraph: { firstNumbered: false, numeral: 'arabic', indent: 'nested' },
        item: { style: 'paren' },
        subitem: { style: 'iroha' },
    })
}

let lineNums: number[] = []
let lineEls: HTMLElement[] = []
let activeEl: HTMLElement | null = null
let scrollEl: HTMLElement | null = null
function indexPreview() {
    lineEls = []
    lineNums = []
    for (const el of preview.value?.querySelectorAll<HTMLElement>('[data-line]') ?? []) {
        const n = Number(el.dataset.line)
        if (n < 0) continue
        lineEls.push(el)
        lineNums.push(n)
    }
    activeEl = null
    scrollEl = null
    setActive(cursorLine.value, false)
}
watch(html, indexPreview, { flush: 'post' })
function elementAt(line: number): HTMLElement | null {
    const i = lastAtOrBefore(lineNums, line)
    return i < 0 ? null : lineEls[i]
}
function setActive(line: number, reveal: boolean) {
    const el = elementAt(line)
    if (el === activeEl) return
    activeEl?.classList.remove('cd-active')
    activeEl = el
    if (!el) return
    el.classList.add('cd-active')
    if (reveal) el.scrollIntoView({ block: 'nearest' })
}
function onCursor(line: number) {
    cursorLine.value = line
    if (showPrint.value) pdfPages.value?.reveal(line)
    else setActive(line, true)
}
function onScroll(top: number) {
    if (showPrint.value) return pdfPages.value?.follow(top)
    const host = preview.value
    const el = elementAt(top)
    if (!host || !el || el === scrollEl) return
    scrollEl = el
    host.scrollTo({ top: el.offsetTop - 24 })
}
function onPreviewClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
    if (el) editor.value?.goToLine(Number(el.dataset.line))
}
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const EDITOR_STEP = 1
const PREVIEW_STEP = 10
function zoomBy(editorSteps: number, previewSteps: number) {
    const p = app.prefs
    app.setPrefsLive({
        editorFontSize: clamp(p.editorFontSize + editorSteps * EDITOR_STEP, 10, 28),
        previewZoom: clamp(p.previewZoom + previewSteps * PREVIEW_STEP, 50, 200),
    })
}
function zoomEditor(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
    e.preventDefault()
    const d = e.deltaY < 0 ? 1 : -1
    zoomBy(d, app.prefs.zoomLinked ? d : 0)
}
function zoomPreview(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
    e.preventDefault()
    const d = e.deltaY < 0 ? 1 : -1
    zoomBy(app.prefs.zoomLinked ? d : 0, d)
}
function setPreviewZoom(v: number | number[] | null | undefined) {
    const n = Number(Array.isArray(v) ? v[0] : v)
    if (!Number.isFinite(n)) return
    const next = clamp(Math.round(n), 50, 200)
    const steps = app.prefs.zoomLinked ? Math.round((next - app.prefs.previewZoom) / PREVIEW_STEP) : 0
    app.setPrefsLive({ previewZoom: next, editorFontSize: clamp(app.prefs.editorFontSize + steps * EDITOR_STEP, 10, 28) })
}

async function saveVersion(input: SaveRequest) {
    await writeNow()
    const oid = await app.run(async () => {
        if (input.draftName) await window.api.createBranch(app.repoDir!, input.draftName)
        return window.api.saveVersion(app.repoDir!, {
            message: input.message,
            effectiveDate: input.effectiveDate,
            docPath: path,
        })
    })
    if (input.draftName) await app.refreshDocs()
    if (!oid) return
    showSave.value = false
    await Promise.all([app.refreshDocs(), loadSaved()])
    const s = app.prefs.pushOnSave ? await app.sync() : ({ state: 'local' } as const)
    void app.refreshIssueCount()
    if (s?.state === 'local' || s?.state === 'upToDate') app.notify(t.value.editor.savedVersion(app.onDraft ? (app.currentBranch?.label ?? '') : null))
}

const aiRunning = ref(false)
const beforeAi = ref<string | null>(null)
const aiChanged = ref(false)

async function reloadFromDisk() {
    editor.value?.flush()
    await writing
    const fresh = await window.api.readDoc(app.repoDir!, path)
    const mine = text.value
    const base = lastWritten
    lastWritten = fresh
    if (fresh === mine) {
        saving.value = 'saved'
        return
    }
    if (mine === base) {
        clearTimeout(timer)
        text.value = fresh
        saving.value = 'saved'
        return
    }
    const merged = autoMerge(base, mine, fresh)
    if (merged !== null) text.value = merged
    else app.notify(t.value.editor.conflictKept, true)
    void writeNow()
}

const offDocChanged = app.onDocChanged(async (e) => {
    if (e.dir !== app.repoDir || e.path !== path) return
    await reloadFromDisk()
    if (e.by === 'ai') aiChanged.value = true
    else app.notify(t.value.editor.externalAi)
})
onBeforeUnmount(offDocChanged)

async function onAiStart() {
    await writeNow()
    beforeAi.value = text.value
    aiChanged.value = false
    aiRunning.value = true
}
async function onAiEnd() {
    aiRunning.value = false
    await reloadFromDisk()
}
function revertAi() {
    if (beforeAi.value === null) return
    text.value = beforeAi.value
    aiChanged.value = false
}

async function discard() {
    confirmDiscard.value = false
    editor.value?.flush()
    await nextTick()
    clearTimeout(timer)
    await app.run(() => window.api.discardChanges(app.repoDir!, path), t.value.editor.discarded)
    await app.refreshDocs()
    if (!app.docs.some((d) => d.path === path)) {
        app.view = 'docs'
        return
    }
    const [fresh] = await Promise.all([window.api.readDoc(app.repoDir!, path), loadSaved()])
    lastWritten = fresh
    text.value = fresh
    saving.value = 'idle'
}

async function exportAs(format: 'pdf' | 'docx' | 'html' | 'md') {
    await writeNow()
    const name = doc.value.title || path.replace(/\.md$/, '')
    const signing = format === 'pdf' ? await pdfSign.plan('export', `${name}.pdf`, undefined, { dir: app.repoDir ?? undefined }) : { sign: false }
    if (!signing) return
    const out = await app.run(() =>
        window.api.exportFile({ kind: 'doc', format, source: text.value, name, style: toPlain(app.style), dir: app.repoDir!, docPath: path, ...signing }),
    )
    if (out) app.notifyExported(t.value.editor.exported, out)
}

const changed = computed(() => app.currentDoc?.changed)
async function openSave() {
    const main = app.mainBranch
    newDoc.value = !main || (await window.api.readAt(app.repoDir!, main.oid, path).catch(() => null)) === null
    showSave.value = true
}
async function saveShortcut() {
    if (showSave.value || app.dialog) return
    await app.flushEditor()
    if (app.currentDoc?.changed) await openSave()
    else app.notify(t.value.editor.unchanged)
}
defineShortcuts({ meta_s: { handler: () => void saveShortcut(), usingInput: true } })
const position = computed(() => positionLabel(doc.value, cursorLine.value))
const trail = useArticleTrail(path, doc, cursorLine)
const trailOpen = ref(false)
watch(trailOpen, (v) => v && void trail.loadCommits())
function openTrailVersion(date: string) {
    trailOpen.value = false
    app.releasesSelect = date
    app.openDoc(path, 'releases')
}
function openTrailCommit(oid: string) {
    trailOpen.value = false
    app.historySelect = oid
    app.view = 'history'
}
const chars = computed(() => settled.value.replace(/<!--[\s\S]*?-->/g, '').replace(/\s/g, '').length)
const articleCount = computed(() => doc.value.chapters.reduce((n, c) => n + c.articles.length, 0))
const saveState = computed(() => {
    const s = t.value.editor.saveState
    return saving.value === 'pending' ? s.pending : changed.value ? s.dirty : s.clean
})
const exportMenu = computed<DropdownMenuItem[]>(() => {
    const m = t.value.editor.toolbar
    return [
        { label: m.exportPdf, icon: 'i-lucide-file-text', onSelect: () => exportAs('pdf') },
        { label: m.exportWord, icon: 'i-lucide-file-type', onSelect: () => exportAs('docx') },
        { label: m.exportHtml, icon: 'i-lucide-file-code', onSelect: () => exportAs('html') },
        ...(isEnabled(app.settings, 'houritsuExport') ? [{ label: m.exportMd, icon: 'i-lucide-file-code-2', onSelect: () => exportAs('md') }] : []),
    ]
})
const viewModes = computed(() => [
    { value: 'edit' as const, icon: 'i-lucide-square-pen', tooltip: t.value.editor.toolbar.editOnly },
    { value: 'split' as const, icon: 'i-lucide-columns-2', tooltip: t.value.editor.toolbar.split },
    { value: 'preview' as const, icon: 'i-lucide-book-open', tooltip: t.value.editor.toolbar.previewOnly },
])
</script>

<template>
    <div v-if="loaded" class="editor-page">
        <div ref="toolbar" class="cd-toolbar toolbar">
            <UTooltip :text="t.editor.toolbar.outline">
                <UButton
                    icon="i-lucide-list-tree"
                    size="sm"
                    square
                    data-guide="outline"
                    :color="outlinePane.state.value.collapsed ? 'neutral' : 'primary'"
                    :variant="outlinePane.state.value.collapsed ? 'ghost' : 'soft'"
                    @click="outlinePane.toggle()"
                />
            </UTooltip>
            <span class="sep" />
            <UFieldGroup size="sm" data-guide="undo">
                <UTooltip :text="t.editor.toolbar.undoTip(keys('Ctrl+Z'))">
                    <UButton
                        icon="i-lucide-undo-2"
                        square
                        color="neutral"
                        variant="outline"
                        :disabled="!history.undo"
                        :aria-label="t.editor.toolbar.undo"
                        @click="editor?.undo()"
                    />
                </UTooltip>
                <UTooltip :text="t.editor.toolbar.redoTip(REDO_KEYS)">
                    <UButton
                        icon="i-lucide-redo-2"
                        square
                        color="neutral"
                        variant="outline"
                        :disabled="!history.redo"
                        :aria-label="t.editor.toolbar.redo"
                        @click="editor?.redo()"
                    />
                </UTooltip>
            </UFieldGroup>
            <UFieldGroup size="sm" data-guide="add">
                <UTooltip :text="t.editor.toolbar.addArticle(keys('Ctrl+Alt+A'))">
                    <UButton :label="t.editor.toolbar.article" icon="i-lucide-plus" color="neutral" variant="outline" @click="addArticle" />
                </UTooltip>
                <UTooltip :text="t.editor.toolbar.addParagraph(keys('Ctrl+Alt+P'))">
                    <UButton :label="t.editor.toolbar.paragraph" icon="i-lucide-plus" color="neutral" variant="outline" @click="addParagraph" />
                </UTooltip>
                <UTooltip :text="t.editor.toolbar.addItem(keys('Ctrl+Alt+I'))">
                    <UButton :label="t.editor.toolbar.item" icon="i-lucide-plus" color="neutral" variant="outline" @click="addItem" />
                </UTooltip>
                <UTooltip :text="t.editor.toolbar.addSubitem">
                    <UButton :label="t.editor.toolbar.subitem" icon="i-lucide-plus" color="neutral" variant="outline" @click="addSubitem" />
                </UTooltip>
            </UFieldGroup>
            <UTooltip :text="compact ? t.editor.toolbar.insertTip : ''">
                <UDropdownMenu :items="insertMenu" :content="{ onCloseAutoFocus: backToEditor }">
                    <UButton
                        :label="compact ? undefined : t.editor.toolbar.insert"
                        :aria-label="t.editor.toolbar.insert"
                        icon="i-lucide-square-plus"
                        data-guide="insert"
                        trailing-icon="i-lucide-chevron-down"
                        size="sm"
                        color="neutral"
                        variant="outline"
                    />
                </UDropdownMenu>
            </UTooltip>
            <UTooltip :text="compact ? t.editor.toolbar.formatting : ''">
                <UButton
                    :label="compact ? undefined : t.editor.toolbar.formatting"
                    :aria-label="t.editor.toolbar.formatting"
                    icon="i-lucide-sliders-horizontal"
                    data-guide="config"
                    size="sm"
                    :color="showConfig ? 'primary' : 'neutral'"
                    :variant="showConfig ? 'soft' : 'outline'"
                    @click="showConfig = !showConfig"
                >
                    <template v-if="doc.warnings.length" #trailing>
                        <UBadge :label="String(doc.warnings.length)" color="error" size="sm" />
                    </template>
                </UButton>
            </UTooltip>
            <span class="cd-grow" />
            <SegmentSwitch v-model="layout.mode" :aria-label="t.editor.toolbar.view" :items="viewModes" />
            <UTooltip :text="t.editor.toolbar.ai">
                <UButton
                    v-if="!demo"
                    label="AI"
                    icon="i-lucide-sparkles"
                    data-guide="ai"
                    size="sm"
                    :color="layout.ai ? 'primary' : 'neutral'"
                    :variant="layout.ai ? 'soft' : 'outline'"
                    @click="layout.ai = !layout.ai"
                />
            </UTooltip>
            <span class="sep" />
            <UTooltip v-if="changed" :text="compact ? t.editor.toolbar.discard : ''">
                <UButton
                    :label="compact ? undefined : t.editor.toolbar.discard"
                    :aria-label="t.editor.toolbar.discard"
                    :icon="compact ? 'i-lucide-rotate-ccw' : undefined"
                    size="sm"
                    color="error"
                    variant="ghost"
                    @click="confirmDiscard = true"
                />
            </UTooltip>
            <UDropdownMenu :items="exportMenu">
                <UButton
                    :label="compact ? undefined : t.editor.toolbar.export"
                    :aria-label="t.editor.toolbar.export"
                    :title="compact ? t.editor.toolbar.exportTip : undefined"
                    icon="i-lucide-download"
                    data-guide="export"
                    trailing-icon="i-lucide-chevron-down"
                    size="sm"
                    color="neutral"
                    variant="outline"
                />
            </UDropdownMenu>
            <UButton :label="t.editor.toolbar.saveVersion" icon="i-lucide-save" size="sm" :disabled="!changed" data-guide="save" @click="openSave" />
        </div>
        <ConfigPanel v-if="showConfig" :config="doc.config" :warnings="doc.warnings" :style-id="doc.styleId" @change="changeConfig" @preset="preset" />
        <div ref="body" class="body">
            <PaneRail
                v-if="outlinePane.state.value.collapsed"
                :pane="outlinePane"
                side="left"
                :label="t.editor.toolbar.outline"
                icon="i-lucide-list-tree"
                data-guide="outline"
            />
            <template v-else>
                <div class="ed-left" :style="paneStyle(outlinePane)">
                    <DocTree class="ed-docs" :pane="outlinePane" />
                    <EditorOutline class="ed-outline-pane" :legal="doc" :line="cursorLine" @jump="(l) => editor?.goToLine(l)" />
                </div>
                <PaneResizer :pane="outlinePane" side="left" :label="t.editor.toolbar.outline" />
            </template>

            <PaneRail v-if="mode === 'preview'" :pane="editPane" side="left" :label="t.editor.panes.edit" icon="i-lucide-square-pen" />
            <!-- v-if にすると「元に戻す」の履歴が消えるので、v-show で隠す -->
            <div v-show="mode !== 'preview'" ref="editCol" class="cd-pane-col pane" :style="editStyle">
                <div class="cd-pane-bar">
                    <span class="cd-pane-title">{{ t.editor.panes.edit }}</span>
                    <PaneControls :pane="editPane" side="left" :label="t.editor.panes.edit" />
                </div>
                <UContextMenu :items="editMenu" size="sm">
                    <div class="pane-body" @wheel="zoomEditor" @contextmenu="onEditorMenu">
                        <CodeEditor
                            ref="editor"
                            v-model="text"
                            :legal="doc"
                            :wrap="app.prefs.lineWrap"
                            :proofread="app.prefs.proofread"
                            :readonly="aiRunning"
                            :diff-base="savedText"
                            :spell-lang="app.prefs.spellcheck !== false ? spellLang(doc.styleId, doc.lang) : null"
                            @cursor="onCursor"
                            @scroll="onScroll"
                            @shortcut="onShortcut"
                            @history="(h) => (history = h)"
                            @images="addImages"
                            @issues="(l) => (issueList = l)"
                            @open-issues="issuesOpen ? (issuesOpen = false) : toggleIssues('all')"
                        />
                    </div>
                </UContextMenu>
                <IssuePane
                    v-if="issuesOpen"
                    v-model:filter="issueFilter"
                    :items="issueList"
                    :doc="doc"
                    :active="activeIssue"
                    @pick="pickIssue"
                    @close="issuesOpen = false"
                />
            </div>
            <PaneResizer v-if="mode === 'split'" :pane="editBase" side="left" :label="t.editor.panes.edit" />

            <div v-show="mode !== 'edit'" class="cd-pane-col pane preview-col">
                <div class="cd-pane-bar">
                    <span class="cd-pane-title">{{ t.editor.panes.preview }}</span>
                    <span v-if="showPrint" class="pdf-state">
                        <UIcon v-if="pdfBusy" name="i-lucide-loader-circle" class="spin" :aria-label="t.editor.panes.rendering" />
                    </span>
                    <div class="zoom" data-guide="zoom">
                        <USlider
                            :model-value="app.prefs.previewZoom"
                            :min="50"
                            :max="200"
                            :step="10"
                            size="xs"
                            class="zoom-slider"
                            :aria-label="t.editor.panes.zoom"
                            @update:model-value="setPreviewZoom"
                        />
                        <UInputNumber
                            :model-value="app.prefs.previewZoom"
                            :min="50"
                            :max="200"
                            :step="1"
                            size="xs"
                            class="zoom-input"
                            :aria-label="t.editor.panes.zoomPercent"
                            @update:model-value="setPreviewZoom"
                        />
                        <span class="zoom-unit">%</span>
                        <UTooltip :text="t.editor.panes.zoomLink">
                            <UButton
                                :icon="app.prefs.zoomLinked ? 'i-lucide-link' : 'i-lucide-unlink'"
                                size="xs"
                                :color="app.prefs.zoomLinked ? 'primary' : 'neutral'"
                                :variant="app.prefs.zoomLinked ? 'soft' : 'ghost'"
                                :aria-label="t.editor.panes.zoomLink"
                                :aria-pressed="app.prefs.zoomLinked"
                                @click="app.setPrefsLive({ zoomLinked: !app.prefs.zoomLinked })"
                            />
                        </UTooltip>
                    </div>
                    <SegmentSwitch v-if="!demo" v-model="printKind" size="xs" :aria-label="t.editor.panes.previewKind" :items="PREVIEW_KINDS" class="kind" />
                    <PaneControls :pane="previewPane" :side="layout.ai ? 'left' : 'right'" :label="t.editor.panes.preview" />
                </div>
                <div v-if="showPrint" class="pane-body cd-canvas print-body">
                    <p v-if="pdfError" class="pdf-error">{{ t.editor.panes.pdfFailed(pdfError) }}</p>
                    <PdfPages
                        ref="pdfPages"
                        class="pdf"
                        :data="pdfData"
                        :zoom="app.prefs.previewZoom"
                        :line="cursorLine"
                        @jump="(l) => editor?.goToLine(l)"
                        @wheel="zoomPreview"
                    />
                </div>
                <div v-else ref="preview" class="pane-body cd-preview cd-canvas" @click="onPreviewClick" @wheel="zoomPreview">
                    <div class="paper cd-paper" :style="{ zoom: app.prefs.previewZoom / 100 }" v-html="html" />
                </div>
            </div>
            <PaneRail
                v-if="mode === 'edit'"
                :pane="previewRail"
                side="right"
                :label="squeezed ? t.editor.panes.previewSqueezed : t.editor.panes.preview"
                icon="i-lucide-book-open"
            />

            <template v-if="layout.ai && !demo">
                <PaneRail v-if="aiPane.state.value.collapsed" :pane="aiPane" side="right" label="AI" icon="i-lucide-sparkles" />
                <PaneResizer v-else :pane="aiPane" side="right" label="AI" />
                <!-- 畳んでも会話を残すため、v-if ではなく v-show で隠す -->
                <AiPanel
                    v-show="!aiPane.state.value.collapsed"
                    :style="paneStyle(aiPane)"
                    :pane="aiPane"
                    :path="path"
                    :selection="() => editor?.selectedText() ?? ''"
                    :can-revert="aiChanged && beforeAi !== null"
                    @start="onAiStart"
                    @end="onAiEnd"
                    @revert="revertAi"
                    @close="layout.ai = false"
                />
            </template>
        </div>
        <footer class="cd-statusbar">
            <div class="issue-pills">
                <div v-for="k in ISSUE_KINDS" :key="k.kind" class="pill" data-guide="proofread">
                    <UTooltip :text="t.editor.status.issueList(k.kind, keys('Ctrl+Shift+M'))">
                        <UButton
                            :icon="k.icon"
                            :label="String(issues[k.count])"
                            size="xs"
                            variant="soft"
                            :color="issues[k.count] ? k.color : 'neutral'"
                            class="seg first count"
                            :class="{ on: issuesOpen && issueFilter === k.kind }"
                            :disabled="mode === 'preview'"
                            :aria-label="t.editor.status.issueListAria(k.kind)"
                            @click="toggleIssues(k.kind)"
                        />
                    </UTooltip>
                    <UButton
                        icon="i-lucide-chevron-up"
                        size="xs"
                        variant="soft"
                        :color="issues[k.count] ? k.color : 'neutral'"
                        class="seg mid"
                        :disabled="mode === 'preview' || !issues[k.count]"
                        :aria-label="t.editor.status.prevIssue(k.kind)"
                        :title="t.editor.status.prevIssue(k.kind)"
                        @click="goIssue(k.kind, -1)"
                    />
                    <UButton
                        icon="i-lucide-chevron-down"
                        size="xs"
                        variant="soft"
                        :color="issues[k.count] ? k.color : 'neutral'"
                        class="seg last"
                        :disabled="mode === 'preview' || !issues[k.count]"
                        :aria-label="t.editor.status.nextIssue(k.kind)"
                        :title="t.editor.status.nextIssue(k.kind)"
                        @click="goIssue(k.kind, 1)"
                    />
                </div>
            </div>
            <span class="pos"> <UIcon name="i-lucide-map-pin" />{{ position || '—' }} </span>
            <UPopover v-if="trail.trail.value && trail.article.value" v-model:open="trailOpen" :content="{ side: 'top', align: 'start' }">
                <button class="trail-btn" :class="{ pending: trail.trail.value.pending }"><UIcon name="i-lucide-history" />{{ trail.summary.value }}</button>
                <template #content>
                    <ArticleTrail
                        :label="trail.article.value.label"
                        :versions="trail.versions.value"
                        :trail="trail.trail.value"
                        :commits="trail.commits.value"
                        :commit-trail="trail.commitTrail.value"
                        :loading="trail.commitsLoading.value"
                        @version="(v) => openTrailVersion(v.date)"
                        @commit="(c) => openTrailCommit(c.oid)"
                    />
                </template>
            </UPopover>
            <span>{{ t.editor.status.articles(articleCount) }}</span>
            <span>{{ t.editor.status.chars(chars.toLocaleString()) }}</span>
            <span class="cd-grow" />
            <span v-if="issueNote" class="issue-note" :class="issueNote.kind">{{ issueNote.text }}</span>
            <span v-else class="hint">{{ t.editor.status.hint(keys('Ctrl+F')) }}</span>
            <span :class="['save', saving === 'pending' ? 'pending' : changed ? 'dirty' : 'clean']">
                <UIcon :name="saving === 'pending' ? 'i-lucide-loader' : changed ? 'i-lucide-circle-dot' : 'i-lucide-circle-check'" />
                {{ saveState }}
            </span>
        </footer>
        <SealModal v-model:open="sealOpen" @insert="insertSeal" />
        <PropModal v-if="propFor" :sample="propFor.sample" :inline="propFor.inline" :can-inline="propFor.inline" @close="propFor = null" @apply="applyProp" />
        <ClauseLibraryModal
            v-if="showClauses && clauseLibrary"
            :library-dir="clauseLibrary.dir"
            :library-name="clauseLibrary.name"
            :target="doc"
            :target-text="text"
            @close="showClauses = false"
            @insert="insertClause"
        />
        <SaveVersionModal
            v-if="showSave"
            :busy="app.busy"
            :branch-label="app.currentBranch?.label ?? ''"
            :on-main="!app.onDraft"
            :has-history="app.branches.length > 0"
            :new-doc="newDoc"
            :doc-title="doc.title || path.replace(/\.md$/i, '').split('/').pop()!"
            @close="showSave = false"
            @save="saveVersion"
        />
        <ConfirmModal
            v-model:open="confirmDiscard"
            :title="t.editor.discardConfirm.title"
            :description="t.editor.discardConfirm.description"
            :confirm-label="t.editor.discardConfirm.confirm"
            color="error"
            @confirm="discard"
        />
    </div>
</template>

<style scoped>
.trail-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 6px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}

.trail-btn:hover {
    background: var(--ui-bg-accented);
    color: var(--ui-text);
}

.trail-btn.pending {
    color: var(--cd-draft);
}

.issue-pills {
    display: inline-flex;
    gap: 6px;
}

.pill {
    display: inline-flex;
    align-items: stretch;
}

.seg {
    height: 20px;
    border-radius: 0;
}

.seg.first {
    border-radius: 999px 0 0 999px;
}

.seg.mid,
.seg.last {
    margin-left: 1px;
    padding-left: 4px;
    padding-right: 4px;
}

.seg.last {
    border-radius: 0 999px 999px 0;
    padding-right: 6px;
}

.seg.count {
    min-width: 46px;
    font-variant-numeric: tabular-nums;
}

.seg.count.on {
    box-shadow: inset 0 0 0 1px currentColor;
}

.issue-note {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.issue-note.error {
    color: var(--cd-syn-ref-bad);
}

.issue-note.warning {
    color: var(--ui-text);
}

.editor-page {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.toolbar {
    background: var(--ui-bg);
}

.sep {
    width: 1px;
    height: 20px;
    background: var(--ui-border);
    margin: 0 4px;
}

.body {
    flex: 1;
    display: flex;
    min-height: 0;
}

.ed-left {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--ui-border);
    background: var(--cd-sidebar);
}

.ed-left .ed-docs {
    flex: 1 1 0;
    margin-top: 0;
    padding: 8px 8px 0;
    border-bottom: 1px solid var(--ui-border);
}

.ed-left .ed-outline-pane {
    flex: 1 1 0;
    height: auto;
    border-right: none;
}

.pane {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
}

.preview-col {
    min-width: 240px;
}

.pane-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
}

.preview-col {
    min-width: 240px;
    border-left: 1px solid var(--ui-border);
}

.kind {
    flex-shrink: 0;
    margin-right: 4px;
}

.pdf-state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 6px;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.print-body {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.pdf {
    flex: 1 1 0;
    min-height: 0;
}

.pdf-error {
    margin: 16px;
    font-size: 12px;
    color: var(--ui-color-error-500);
}

.zoom {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    margin-right: 6px;
}

.zoom-slider {
    width: 96px;
}

.zoom-input {
    width: 84px;
}

.zoom-unit {
    font-size: 12px;
    color: var(--ui-text-muted);
}

.paper {
    max-width: 210mm;
    margin: 0 auto;
    padding: var(--cd-margin, 20mm);
    min-height: 100%;
}

.paper :deep([data-line]) {
    cursor: pointer;
    border-radius: 2px;
    transition: background-color 0.15s;
}

.paper :deep(.cd-active) {
    background: var(--cd-highlight);
}

.pos {
    color: var(--ui-text-toned);
    font-weight: 600;
}

.hint {
    color: var(--ui-text-dimmed);
}

.save.dirty {
    color: var(--cd-draft);
}

.save.clean {
    color: var(--ui-color-success-500);
}
</style>
