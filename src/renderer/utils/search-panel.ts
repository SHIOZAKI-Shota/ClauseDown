import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    replaceAll,
    replaceNext,
    search,
    SearchQuery,
    setSearchQuery,
} from '@codemirror/search'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'

const ICONS = {
    up: 'm18 15-6-6-6 6',
    down: 'm6 9 6 6 6-6',
    close: 'M18 6 6 18M6 6l12 12',
    expand: 'm9 18 6-6-6-6',
}
function icon(d: string) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', d)
    svg.append(p)
    return svg
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}) {
    const e = document.createElement(tag)
    e.className = cls
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    return e
}

const MAX_COUNT = 9999

function countOf(state: EditorState, q: SearchQuery): { total: number; current: number } {
    if (!q.search || !q.valid) return { total: 0, current: 0 }
    const sel = state.selection.main
    let total = 0
    let current = 0
    const cur = q.getCursor(state)
    for (let r = cur.next(); !r.done; r = cur.next()) {
        total++
        if (r.value.from === sel.from && r.value.to === sel.to) current = total
        if (total >= MAX_COUNT) break
    }
    return { total, current }
}

function createPanel(view: EditorView): Panel {
    const dom = el('div', 'cd-find')
    dom.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault()
            closeSearchPanel(view)
        }
    })

    const toggle = el('button', 'cd-find-btn cd-find-expand', { type: 'button', title: '置換を表示', 'aria-label': '置換を表示' })
    toggle.append(icon(ICONS.expand))

    const field = el('div', 'cd-find-field')
    const input = el('input', 'cd-find-input', { type: 'text', placeholder: '検索', 'aria-label': '検索', 'main-field': 'true' })
    const count = el('span', 'cd-find-count')
    const opt = (label: string, title: string) => {
        const b = el('button', 'cd-find-opt', { type: 'button', title, 'aria-pressed': 'false' })
        b.textContent = label
        return b
    }
    const caseBtn = opt('Aa', '大文字と小文字を区別')
    const wordBtn = opt('語', '単語単位で探す')
    const reBtn = opt('.*', '正規表現')
    field.append(input, count, caseBtn, wordBtn, reBtn)

    const btn = (d: string, title: string, run: () => void) => {
        const b = el('button', 'cd-find-btn', { type: 'button', title, 'aria-label': title })
        b.append(icon(d))
        b.addEventListener('click', () => {
            run()
            input.focus()
        })
        return b
    }
    const prev = btn(ICONS.up, '前へ（Shift+Enter）', () => findPrevious(view))
    const next = btn(ICONS.down, '次へ（Enter）', () => findNext(view))
    const close = btn(ICONS.close, '閉じる（Esc）', () => closeSearchPanel(view))

    const row1 = el('div', 'cd-find-row')
    row1.append(toggle, field, prev, next, close)

    const replaceField = el('div', 'cd-find-field')
    const replaceInput = el('input', 'cd-find-input', { type: 'text', placeholder: '置換後の文字', 'aria-label': '置換後の文字' })
    replaceField.append(replaceInput)
    const textBtn = (label: string, title: string, run: () => void) => {
        const b = el('button', 'cd-find-text', { type: 'button', title })
        b.textContent = label
        b.addEventListener('click', run)
        return b
    }
    const replaceOne = textBtn('置換', '1件置換して次へ（Enter）', () => replaceNext(view))
    const replaceEvery = textBtn('すべて置換', 'すべて置換（Ctrl+Alt+Enter）', () => replaceAll(view))
    const row2 = el('div', 'cd-find-row cd-find-replace')
    row2.append(el('span', 'cd-find-spacer'), replaceField, replaceOne, replaceEvery)

    dom.append(row1, row2)

    let query = getSearchQuery(view.state)
    const readonly = () => view.state.readOnly
    function setReplaceOpen(on: boolean) {
        dom.classList.toggle('open', on && !readonly())
        toggle.setAttribute('aria-expanded', String(on))
    }
    function show() {
        input.value = query.search
        replaceInput.value = query.replace
        caseBtn.setAttribute('aria-pressed', String(query.caseSensitive))
        wordBtn.setAttribute('aria-pressed', String(query.wholeWord))
        reBtn.setAttribute('aria-pressed', String(query.regexp))
        scheduleCount()
    }
    let countTimer: ReturnType<typeof setTimeout> | undefined
    function scheduleCount() {
        clearTimeout(countTimer)
        countTimer = setTimeout(refreshCount, view.state.doc.length > 200_000 ? 400 : 150)
    }
    function refreshCount() {
        clearTimeout(countTimer)
        const { total, current } = countOf(view.state, query)
        dom.classList.toggle('none', !!query.search && total === 0)
        dom.classList.toggle('bad', !!query.search && !query.valid)
        count.textContent = !query.search ? '' : !query.valid ? '正規表現の誤り' : total === 0 ? '0 件' : `${current || '-'} / ${total >= MAX_COUNT ? `${MAX_COUNT}+` : total}`
    }
    function commit(patch: Partial<ConstructorParameters<typeof SearchQuery>[0]>) {
        const q = new SearchQuery({
            search: input.value,
            replace: replaceInput.value,
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            regexp: query.regexp,
            ...patch,
        })
        if (q.eq(query)) return
        query = q
        view.dispatch({ effects: setSearchQuery.of(q) })
    }

    input.addEventListener('input', () => commit({}))
    replaceInput.addEventListener('input', () => commit({}))
    caseBtn.addEventListener('click', () => commit({ caseSensitive: !query.caseSensitive }))
    wordBtn.addEventListener('click', () => commit({ wholeWord: !query.wholeWord }))
    reBtn.addEventListener('click', () => commit({ regexp: !query.regexp }))
    toggle.addEventListener('click', () => setReplaceOpen(!dom.classList.contains('open')))

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) findPrevious(view)
            else findNext(view)
        }
    })
    replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if ((e.ctrlKey || e.metaKey) && e.altKey) replaceAll(view)
            else replaceNext(view)
        }
    })

    show()
    setReplaceOpen(false)

    return {
        dom,
        top: true,
        mount: () => input.select(),
        destroy: () => clearTimeout(countTimer),
        update(u: ViewUpdate) {
            const q = getSearchQuery(u.state)
            if (!q.eq(query)) {
                query = q
                show()
            } else if (u.docChanged || u.selectionSet) {
                scheduleCount()
            }
            if (u.startState.readOnly !== u.state.readOnly) setReplaceOpen(dom.classList.contains('open'))
        },
    }
}

const theme = EditorView.theme({
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--ui-border)', backgroundColor: 'var(--ui-bg-elevated)' },
    '.cd-find': { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 8px', fontFamily: 'var(--font-sans, inherit)', fontSize: '12px' },
    '.cd-find-row': { display: 'flex', alignItems: 'center', gap: '4px' },
    '.cd-find-replace': { display: 'none' },
    '.cd-find.open .cd-find-replace': { display: 'flex' },
    '.cd-find-spacer': { width: '24px', flexShrink: '0' },
    '.cd-find-field': {
        flex: '1',
        minWidth: '0',
        maxWidth: '420px',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '28px',
        padding: '0 3px 0 8px',
        border: '1px solid var(--ui-border-accented)',
        borderRadius: '6px',
        backgroundColor: 'var(--ui-bg)',
    },
    '.cd-find-field:focus-within': { borderColor: 'var(--ui-color-primary-500)', boxShadow: '0 0 0 1px var(--ui-color-primary-500)' },
    '.cd-find.bad .cd-find-row:first-child .cd-find-field, .cd-find.none .cd-find-row:first-child .cd-find-field': {
        borderColor: 'var(--ui-color-error-500)',
        boxShadow: 'none',
    },
    '.cd-find-input': {
        flex: '1',
        minWidth: '0',
        height: '100%',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'var(--ui-text)',
        fontSize: '13px',
        fontFamily: 'inherit',
    },
    '.cd-find-input::placeholder': { color: 'var(--ui-text-dimmed)' },
    '.cd-find-count': { flexShrink: '0', padding: '0 6px', color: 'var(--ui-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
    '.cd-find.none .cd-find-count, .cd-find.bad .cd-find-count': { color: 'var(--ui-color-error-500)' },
    '.cd-find-opt': {
        flexShrink: '0',
        minWidth: '22px',
        height: '20px',
        padding: '0 4px',
        borderRadius: '4px',
        border: '1px solid transparent',
        color: 'var(--ui-text-muted)',
        fontSize: '11px',
        fontWeight: '600',
        cursor: 'pointer',
    },
    '.cd-find-opt:hover': { backgroundColor: 'var(--ui-bg-accented)', color: 'var(--ui-text)' },
    '.cd-find-opt[aria-pressed="true"]': {
        backgroundColor: 'color-mix(in oklab, var(--ui-color-primary-500) 18%, transparent)',
        borderColor: 'color-mix(in oklab, var(--ui-color-primary-500) 55%, transparent)',
        color: 'var(--ui-color-primary-500)',
    },
    '.cd-find-btn': {
        flexShrink: '0',
        width: '24px',
        height: '24px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '5px',
        color: 'var(--ui-text-muted)',
        cursor: 'pointer',
    },
    '.cd-find-btn:hover': { backgroundColor: 'var(--ui-bg-accented)', color: 'var(--ui-text-highlighted)' },
    '.cd-find-btn svg': { width: '16px', height: '16px', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
    '.cd-find-expand svg': { transition: 'transform 0.15s' },
    '.cd-find.open .cd-find-expand svg': { transform: 'rotate(90deg)' },
    '.cd-find-text': {
        flexShrink: '0',
        height: '26px',
        padding: '0 10px',
        borderRadius: '6px',
        border: '1px solid var(--ui-border-accented)',
        backgroundColor: 'var(--ui-bg)',
        color: 'var(--ui-text)',
        fontSize: '12px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    '.cd-find-text:hover': { backgroundColor: 'var(--ui-bg-accented)' },
    '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--ui-color-primary-500) 35%, transparent)' },
})

export function searchPanel(): Extension {
    return [search({ top: true, createPanel }), theme]
}
