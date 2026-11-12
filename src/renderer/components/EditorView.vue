<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { parseLegal, articleTitle } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { autoMerge } from '@shared/merge3'
import { DEFAULT_CONFIG, writeConfig, type DocConfig } from '@shared/config'
import { extOfMime } from '@shared/images'
import { clauseInsertLine, type ClauseInsert } from '@shared/clauses'
import { isEnabled } from '@shared/experiments'
import { useApp } from '~/stores/app'
import { lastAtOrBefore, positionLabel } from '~/utils/legal-editor'
import { toPlain } from '~/utils/ipc'
import { useStoredRef } from '~/composables/useStoredRef'
import { useElementSize } from '@vueuse/core'
import { usePane, paneStyle, type Pane } from '~/composables/usePane'
import CodeEditor from '~/components/CodeEditor.vue'
import type { SaveRequest } from '~/components/SaveVersionModal.vue'

const app = useApp()
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

const outlinePane = usePane('outline', { size: 230, min: 160, max: 480 })
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
const printKind = computed({
    get: () => app.prefs.previewKind ?? 'normal',
    set: (v: 'normal' | 'print') => app.setPrefsLive({ previewKind: v }),
})
const PREVIEW_KINDS = [
    { value: 'normal' as const, label: 'ノーマル', icon: 'i-lucide-scroll-text' },
    { value: 'print' as const, label: '印刷', icon: 'i-lucide-printer' },
]
const showPrint = computed(() => mode.value !== 'edit' && printKind.value === 'print')
const html = computed(() => (mode.value === 'edit' || showPrint.value ? '' : withImages(renderDoc(doc.value), app.repoDir, path)))
const pdfUrl = ref('')
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
        const old = pdfUrl.value
        pdfUrl.value = `${URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))}#toolbar=0&view=FitH`
        pdfError.value = ''
        if (old) URL.revokeObjectURL(old.split('#')[0])
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
        if (on && loaded.value) pdfTimer = setTimeout(() => void makePdf(), pdfUrl.value ? 900 : 0)
    },
    { deep: true },
)
watch(loaded, (v) => v && showPrint.value && void makePdf())
onBeforeUnmount(() => {
    clearTimeout(pdfTimer)
    if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value.split('#')[0])
})

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
            app.notify(`文書を保存できませんでした：${(e as Error).message}`, true)
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
function addSupplement() {
    const body = '\n## 附則 {supplement}\n- この規則は、　年　月　日から施行する。\n'
    editor.value?.insertAfterLine(body, body.indexOf('　年'))
}
function addClosing() {
    const body = '\n## {closing}\n本契約の成立を証するため、本書2通を作成し、甲乙記名押印のうえ、各1通を保有する。\n\n　年　月　日\n\n甲　\n\n乙　\n'
    editor.value?.insertAfterLine(body, body.indexOf('本契約'))
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
    const body = ['| 区分 | 内容 |', '|---|---|', '| ・・・ | ・・・ |'].map((l) => i + l).join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + i.length + 2)
}
function addInlineMath() {
    editor.value?.wrapInline('$', '$')
}
function addMathBlock() {
    const i = blockIndent()
    const body = ['```math', '\\text{補助金の額} = \\min\\left(\\dfrac{2}{3}C,\\ 1{,}000{,}000\\right)', '```'].map((l) => i + l).join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + i.length + 8)
}
function addFigure() {
    const i = blockIndent()
    const body = ['```mermaid', 'flowchart LR', '  A[申請] --> B[承認]', '  B --> C[実施]', '```'].map((l) => i + l).join('\n')
    editor.value?.insertAfterLine(`\n${body}\n`, 1 + body.indexOf('A['))
}
async function addImages(files: File[]) {
    for (const f of files) {
        const data = new Uint8Array(await f.arrayBuffer())
        const saved = await app.run(() => window.api.saveImage(app.repoDir!, path, data, extOfMime(f.type) ?? 'png'))
        if (saved) editor.value?.insertBlock(`![図](${saved.src})`)
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
    editor.value?.insertAfterLine('\n## 別表第一 {appendix}\n| 区分 | 内容 |\n|---|---|\n| ・・・ | ・・・ |\n', 4)
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
const editMenu = computed<DropdownMenuItem[][]>(() => [
    [
        { label: '切り取り', icon: 'i-lucide-scissors', kbds: ['meta', 'x'], disabled: selEmpty.value, onSelect: () => editCommand('cut') },
        { label: 'コピー', icon: 'i-lucide-copy', kbds: ['meta', 'c'], disabled: selEmpty.value, onSelect: () => editCommand('copy') },
        { label: '貼り付け', icon: 'i-lucide-clipboard', kbds: ['meta', 'v'], onSelect: () => editCommand('paste') },
    ],
    [
        { label: selEmpty.value ? 'この行に書式を付ける…' : '選んだ範囲に書式を付ける…', icon: 'i-lucide-type', onSelect: addFormat },
        { label: 'この行の前で改ページ', icon: 'i-lucide-separator-horizontal', onSelect: addPageBreak },
    ],
    [{ label: '条参照を入れる', icon: 'i-lucide-link', onSelect: () => editor.value?.insertRef() }],
    [{ label: articleHere() ? 'この条について課題を作る' : 'この文書について課題を作る', icon: 'i-lucide-list-todo', onSelect: issueHere }],
])
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
const issues = ref({ errors: 0, warnings: 0 })
const issueNote = ref<{ kind: 'error' | 'warning'; text: string } | null>(null)
let issueTimer: ReturnType<typeof setTimeout> | undefined
function goIssue(kind: 'error' | 'warning') {
    const msg = editor.value?.nextIssue(kind)
    clearTimeout(issueTimer)
    issueNote.value = msg ? { kind, text: msg } : null
    if (msg) issueTimer = setTimeout(() => (issueNote.value = null), 10_000)
}
watch(text, () => (issueNote.value = null))
const showClauses = ref(false)
const clauseLibrary = computed(() =>
    isEnabled(app.settings, 'clauseLibrary') ? (app.settings?.repos.find((r) => r.dir === app.settings?.clauseLibrary) ?? null) : null,
)
function openClauses() {
    if (!clauseLibrary.value) return app.notify('設定の「Developer」で、条項ライブラリに使うリポジトリを選んでください', true)
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
const insertMenu = computed<DropdownMenuItem[][]>(() => [
    [
        { label: '章', icon: 'i-lucide-heading-2', onSelect: addChapter },
        {
            label: '条',
            icon: 'i-lucide-heading-3',
            children: [
                { label: '条', kbds: ['meta', 'alt', 'a'], onSelect: addArticle },
                { label: '枝番号の条（第○条の2）', onSelect: addBranchArticle },
                { label: '削除された条（第○条　削除）', onSelect: addDeletedArticle },
                { label: '番号を指定した条（{n=10}）', onSelect: addNumberedArticle },
            ],
        },
        {
            label: '項・号',
            icon: 'i-lucide-list',
            children: [
                { label: '項', kbds: ['meta', 'alt', 'p'], onSelect: addParagraph },
                { label: '号', kbds: ['meta', 'alt', 'i'], onSelect: addItem },
                { label: '号の細分', onSelect: addSubitem },
                { label: '号の番号を指定（{n=3}）', onSelect: addItemNumber },
                { label: '号の枝番号（{b=2}）', onSelect: addItemBranch },
            ],
        },
    ],
    [
        { label: '前文（最初の章の前）', icon: 'i-lucide-pilcrow', onSelect: addPreamble },
        { label: '附則', icon: 'i-lucide-book-plus', onSelect: addSupplement },
        { label: '後文・署名欄', icon: 'i-lucide-pen-line', onSelect: addClosing },
        { label: '別表', icon: 'i-lucide-sheet', onSelect: addAppendix },
    ],
    [
        {
            label: '表',
            icon: 'i-lucide-table',
            children: [
                { label: '表', onSelect: addTable },
                { label: '右隣のセルと結合（>）', onSelect: () => editor.value?.insertAtCursor('>') },
                { label: '上のセルと結合（^）', onSelect: () => editor.value?.insertAtCursor('^') },
            ],
        },
        { label: '図（流れ図など）', icon: 'i-lucide-workflow', onSelect: addFigure },
        {
            label: '数式',
            icon: 'i-lucide-sigma',
            children: [
                { label: '文中の数式（$…$）', onSelect: addInlineMath },
                { label: '独立した数式', onSelect: addMathBlock },
            ],
        },
        { label: '画像（ファイルから）…', icon: 'i-lucide-image', onSelect: pickImages },
        { label: '条参照', icon: 'i-lucide-link', kbds: ['[', '['], onSelect: () => editor.value?.insertRef() },
    ],
    [
        { label: '改ページ（この行の前）', icon: 'i-lucide-separator-horizontal', onSelect: addPageBreak },
        { label: '書式を付ける…', icon: 'i-lucide-type', onSelect: addFormat },
    ],
    ...(isEnabled(app.settings, 'clauseLibrary') ? [[{ label: '条項ライブラリから…', icon: 'i-lucide-library', onSelect: openClauses }]] : []),
])
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
    if (kind === 'law') return changeConfig(structuredClone(DEFAULT_CONFIG))
    changeConfig({
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
    setActive(line, true)
}
function onScroll(top: number) {
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
    const where = app.onDraft ? `改定案「${app.currentBranch?.label}」に` : ''
    if (s?.state === 'local' || s?.state === 'upToDate') app.notify(`${where}版を保存しました`)
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
    else app.notify('外部の変更と、この画面で保存していない変更が重なったため、この画面の内容を残しました', true)
    void writeNow()
}

const offDocChanged = app.onDocChanged(async (e) => {
    if (e.dir !== app.repoDir || e.path !== path) return
    await reloadFromDisk()
    if (e.by === 'ai') aiChanged.value = true
    else app.notify('外部の AI（MCP）がこの文書を書き換えました')
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
    await app.run(() => window.api.discardChanges(app.repoDir!, path), '変更を取り消しました')
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

async function exportAs(format: 'pdf' | 'docx' | 'md') {
    await writeNow()
    const name = doc.value.title || path.replace(/\.md$/, '')
    const out = await app.run(() =>
        window.api.exportFile({ kind: 'doc', format, source: text.value, name, style: toPlain(app.style), dir: app.repoDir!, docPath: path }),
    )
    if (out) app.notify(`書き出しました：${out}`)
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
    else app.notify('前の版から変わっていません。書いた内容は自動で PC に書き込んでいます')
}
defineShortcuts({ meta_s: { handler: () => void saveShortcut(), usingInput: true } })
const position = computed(() => positionLabel(doc.value, cursorLine.value))
const chars = computed(() => settled.value.replace(/<!--[\s\S]*?-->/g, '').replace(/\s/g, '').length)
const articleCount = computed(() => doc.value.chapters.reduce((n, c) => n + c.articles.length, 0))
const saveState = computed(() => (saving.value === 'pending' ? '書き込み中…' : changed.value ? '版を保存していない変更があります' : '保存済みの版と同じです'))
</script>

<template>
    <div v-if="loaded" class="editor-page">
        <div ref="toolbar" class="cd-toolbar toolbar">
            <UTooltip text="文書・目次">
                <UButton
                    icon="i-lucide-list-tree"
                    size="sm"
                    square
                    :color="outlinePane.state.value.collapsed ? 'neutral' : 'primary'"
                    :variant="outlinePane.state.value.collapsed ? 'ghost' : 'soft'"
                    @click="outlinePane.toggle()"
                />
            </UTooltip>
            <span class="sep" />
            <UFieldGroup size="sm">
                <UTooltip :text="`元に戻す（${keys('Ctrl+Z')}）`">
                    <UButton
                        icon="i-lucide-undo-2"
                        square
                        color="neutral"
                        variant="outline"
                        :disabled="!history.undo"
                        aria-label="元に戻す"
                        @click="editor?.undo()"
                    />
                </UTooltip>
                <UTooltip :text="`やり直す（${REDO_KEYS}）`">
                    <UButton
                        icon="i-lucide-redo-2"
                        square
                        color="neutral"
                        variant="outline"
                        :disabled="!history.redo"
                        aria-label="やり直す"
                        @click="editor?.redo()"
                    />
                </UTooltip>
            </UFieldGroup>
            <UFieldGroup size="sm">
                <UTooltip :text="`条を追加（${keys('Ctrl+Alt+A')}）`">
                    <UButton label="条" icon="i-lucide-plus" color="neutral" variant="outline" @click="addArticle" />
                </UTooltip>
                <UTooltip :text="`項を追加（${keys('Ctrl+Alt+P')}）`">
                    <UButton label="項" icon="i-lucide-plus" color="neutral" variant="outline" @click="addParagraph" />
                </UTooltip>
                <UTooltip :text="`号を追加（${keys('Ctrl+Alt+I')}）。行頭で Tab を押しても号になります`">
                    <UButton label="号" icon="i-lucide-plus" color="neutral" variant="outline" @click="addItem" />
                </UTooltip>
                <UTooltip text="号の細分（イ、ロ…）を追加">
                    <UButton label="細分" icon="i-lucide-plus" color="neutral" variant="outline" @click="addSubitem" />
                </UTooltip>
            </UFieldGroup>
            <UTooltip :text="compact ? '挿入（章・条・附則・表・図・画像など）' : ''">
                <UDropdownMenu :items="insertMenu" :content="{ onCloseAutoFocus: backToEditor }">
                    <UButton
                        :label="compact ? undefined : '挿入'"
                        aria-label="挿入"
                        icon="i-lucide-square-plus"
                        trailing-icon="i-lucide-chevron-down"
                        size="sm"
                        color="neutral"
                        variant="outline"
                    />
                </UDropdownMenu>
            </UTooltip>
            <UTooltip :text="compact ? '書式設定' : ''">
                <UButton
                    :label="compact ? undefined : '書式設定'"
                    aria-label="書式設定"
                    icon="i-lucide-sliders-horizontal"
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
            <SegmentSwitch
                v-model="layout.mode"
                aria-label="表示"
                :items="[
                    { value: 'edit', icon: 'i-lucide-square-pen', tooltip: '編集のみ' },
                    { value: 'split', icon: 'i-lucide-columns-2', tooltip: '編集とプレビュー' },
                    { value: 'preview', icon: 'i-lucide-book-open', tooltip: 'プレビューのみ' },
                ]"
            />
            <UTooltip text="AI に編集・チェックを頼む">
                <UButton
                    label="AI"
                    icon="i-lucide-sparkles"
                    size="sm"
                    :color="layout.ai ? 'primary' : 'neutral'"
                    :variant="layout.ai ? 'soft' : 'outline'"
                    @click="layout.ai = !layout.ai"
                />
            </UTooltip>
            <span class="sep" />
            <UTooltip v-if="changed" :text="compact ? '変更を取り消す' : ''">
                <UButton
                    :label="compact ? undefined : '変更を取り消す'"
                    aria-label="変更を取り消す"
                    :icon="compact ? 'i-lucide-rotate-ccw' : undefined"
                    size="sm"
                    color="error"
                    variant="ghost"
                    @click="confirmDiscard = true"
                />
            </UTooltip>
            <UDropdownMenu
                :items="[
                    { label: 'PDF に書き出す', icon: 'i-lucide-file-text', onSelect: () => exportAs('pdf') },
                    { label: 'Word に書き出す', icon: 'i-lucide-file-type', onSelect: () => exportAs('docx') },
                    { label: 'Markdown（法令の形・houritsu）に書き出す', icon: 'i-lucide-file-code', onSelect: () => exportAs('md') },
                ]"
            >
                <UButton
                    :label="compact ? undefined : '書き出し'"
                    aria-label="書き出し"
                    :title="compact ? '書き出し（PDF・Word・Markdown）' : undefined"
                    icon="i-lucide-download"
                    trailing-icon="i-lucide-chevron-down"
                    size="sm"
                    color="neutral"
                    variant="outline"
                />
            </UDropdownMenu>
            <UButton label="版を保存" icon="i-lucide-save" size="sm" :disabled="!changed" @click="openSave" />
        </div>
        <ConfigPanel v-if="showConfig" :config="doc.config" :warnings="doc.warnings" @change="changeConfig" @preset="preset" />
        <div ref="body" class="body">
            <PaneRail v-if="outlinePane.state.value.collapsed" :pane="outlinePane" side="left" label="文書・目次" icon="i-lucide-list-tree" />
            <template v-else>
                <div class="ed-left" :style="paneStyle(outlinePane)">
                    <DocTree class="ed-docs" :pane="outlinePane" />
                    <EditorOutline class="ed-outline-pane" :legal="doc" :line="cursorLine" @jump="(l) => editor?.goToLine(l)" />
                </div>
                <PaneResizer :pane="outlinePane" side="left" label="文書・目次" />
            </template>

            <PaneRail v-if="mode === 'preview'" :pane="editPane" side="left" label="編集" icon="i-lucide-square-pen" />
            <!-- v-if にすると「元に戻す」の履歴が消えるので、v-show で隠す -->
            <div v-show="mode !== 'preview'" ref="editCol" class="cd-pane-col pane" :style="editStyle">
                <div class="cd-pane-bar">
                    <span class="cd-pane-title">編集</span>
                    <PaneControls :pane="editPane" side="left" label="編集" />
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
                            @cursor="onCursor"
                            @scroll="onScroll"
                            @shortcut="onShortcut"
                            @history="(h) => (history = h)"
                            @images="addImages"
                            @issues="(n) => (issues = n)"
                        />
                    </div>
                </UContextMenu>
            </div>
            <PaneResizer v-if="mode === 'split'" :pane="editBase" side="left" label="編集" />

            <div v-show="mode !== 'edit'" class="cd-pane-col pane preview-col">
                <div class="cd-pane-bar">
                    <span class="cd-pane-title">プレビュー</span>
                    <span v-if="showPrint" class="pdf-state">
                        <UIcon v-if="pdfBusy" name="i-lucide-loader-circle" class="spin" aria-label="作成中" />
                    </span>
                    <div v-if="!showPrint" class="zoom">
                        <USlider
                            :model-value="app.prefs.previewZoom"
                            :min="50"
                            :max="200"
                            :step="10"
                            size="xs"
                            class="zoom-slider"
                            aria-label="プレビューの倍率"
                            @update:model-value="setPreviewZoom"
                        />
                        <UInputNumber
                            :model-value="app.prefs.previewZoom"
                            :min="50"
                            :max="200"
                            :step="1"
                            size="xs"
                            class="zoom-input"
                            aria-label="プレビューの倍率（%）"
                            @update:model-value="setPreviewZoom"
                        />
                        <span class="zoom-unit">%</span>
                        <UTooltip text="エディタと拡縮を同期する">
                            <UButton
                                :icon="app.prefs.zoomLinked ? 'i-lucide-link' : 'i-lucide-unlink'"
                                size="xs"
                                :color="app.prefs.zoomLinked ? 'primary' : 'neutral'"
                                :variant="app.prefs.zoomLinked ? 'soft' : 'ghost'"
                                aria-label="エディタと拡縮を同期する"
                                :aria-pressed="app.prefs.zoomLinked"
                                @click="app.setPrefsLive({ zoomLinked: !app.prefs.zoomLinked })"
                            />
                        </UTooltip>
                    </div>
                    <SegmentSwitch v-model="printKind" size="xs" aria-label="プレビューの種類" :items="PREVIEW_KINDS" class="kind" />
                    <PaneControls :pane="previewPane" :side="layout.ai ? 'left' : 'right'" label="プレビュー" />
                </div>
                <div v-if="showPrint" class="pane-body cd-canvas print-body">
                    <iframe v-if="pdfUrl" :src="pdfUrl" class="pdf" title="印刷プレビュー" />
                    <p v-if="pdfError" class="pdf-error">PDF を作れませんでした：{{ pdfError }}</p>
                </div>
                <div v-else ref="preview" class="pane-body cd-preview cd-canvas" @click="onPreviewClick" @wheel="zoomPreview">
                    <div class="paper cd-paper" :style="{ zoom: app.prefs.previewZoom / 100 }" v-html="html" />
                </div>
            </div>
            <PaneRail
                v-if="mode === 'edit'"
                :pane="previewRail"
                side="right"
                :label="squeezed ? 'プレビュー（AI を畳んで）' : 'プレビュー'"
                icon="i-lucide-book-open"
            />

            <template v-if="layout.ai">
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
            <span class="pos"> <UIcon name="i-lucide-map-pin" />{{ position || '—' }} </span>
            <span>{{ articleCount }} 条</span>
            <span>{{ chars.toLocaleString() }} 文字</span>
            <UTooltip :text="`次の誤り（赤い波線）へ。右クリックで一覧を開きます（${keys('Ctrl+Shift+M')}）`">
                <button
                    class="issue err"
                    :class="{ none: !issues.errors }"
                    :disabled="mode === 'preview'"
                    @click="goIssue('error')"
                    @contextmenu.prevent="editor?.openIssues()"
                >
                    <UIcon name="i-lucide-circle-x" />{{ issues.errors }}
                </button>
            </UTooltip>
            <UTooltip :text="`次の注意（黄色の波線）へ。右クリックで一覧を開きます（${keys('Ctrl+Shift+M')}）`">
                <button
                    class="issue warn"
                    :class="{ none: !issues.warnings }"
                    :disabled="mode === 'preview'"
                    @click="goIssue('warning')"
                    @contextmenu.prevent="editor?.openIssues()"
                >
                    <UIcon name="i-lucide-triangle-alert" />{{ issues.warnings }}
                </button>
            </UTooltip>
            <span class="cd-grow" />
            <span v-if="issueNote" class="issue-note" :class="issueNote.kind">{{ issueNote.text }}</span>
            <span v-else class="hint">[[ で条参照 ／ Tab で項→号 ／ {{ keys('Ctrl+F') }} で検索</span>
            <span :class="['save', saving === 'pending' ? 'pending' : changed ? 'dirty' : 'clean']">
                <UIcon :name="saving === 'pending' ? 'i-lucide-loader' : changed ? 'i-lucide-circle-dot' : 'i-lucide-circle-check'" />
                {{ saveState }}
            </span>
        </footer>
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
            title="変更を取り消す"
            description="最後に保存した版のあとの変更をすべて取り消します。"
            confirm-label="取り消す"
            color="error"
            @confirm="discard"
        />
    </div>
</template>

<style scoped>
.issue {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    height: 20px;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}

.issue:hover:not(:disabled) {
    background: var(--ui-bg-accented);
}

.issue.err {
    color: var(--cd-syn-ref-bad);
}

.issue.warn {
    color: var(--cd-draft);
}

.issue.none,
.issue:disabled {
    color: var(--ui-text-dimmed);
    cursor: default;
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
    margin-left: auto;
    margin-right: 6px;
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
    padding: 0;
    overflow: hidden;
}

.pdf {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
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
