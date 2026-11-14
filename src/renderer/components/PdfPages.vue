<script setup lang="ts">
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'
// oxlint-disable-next-line import/default -- ?url の default は Vite が作る
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { lineSpans, stripMarks, type LineSpan, type MarkSpot } from '@shared/line-marks'
import { fixRadicals } from '@shared/radicals'
import { lastAtOrBefore } from '~/utils/legal-editor'
import { refDebounced, useElementSize } from '@vueuse/core'

GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{ data: Uint8Array | null; zoom: number; line: number }>()
const emit = defineEmits<{ jump: [line: number] }>()

interface Sheet {
    w: number
    h: number
}

const PT = 96 / 72
const GAP = 24
const host = ref<HTMLDivElement>()
const pageEls = ref<HTMLDivElement[]>([])
const sheets = shallowRef<Sheet[]>([])
const spans = shallowRef<LineSpan[]>([])
const margin = ref(0)
const room = refDebounced(useElementSize(host).width, 150)
const scale = computed(() => {
    const w = (sheets.value[0]?.w ?? 595) * PT
    const fit = room.value > 0 ? Math.min(1, room.value / w) : 1
    return (props.zoom / 100) * PT * fit
})

function onCopy(e: ClipboardEvent) {
    const text = window.getSelection()?.toString()
    if (!text || !e.clipboardData) return
    e.clipboardData.setData('text/plain', fixRadicals(text))
    e.preventDefault()
}
let pdf: PDFDocumentProxy | null = null
let texts: TextContent[] = []
let gen = 0
const visible = new Set<number>()

const isText = (it: TextContent['items'][number]): it is TextItem => 'str' in it
const marked = (it: TextContent['items'][number]): it is TextItem => isText(it) && stripMarks(it.str) !== it.str

function cleanText(tc: TextContent): TextContent {
    const items = tc.items.filter((it) => !marked(it) || stripMarks(it.str).trim()).map((it) => (marked(it) ? { ...it, str: stripMarks(it.str) } : it))
    return { ...tc, items }
}

watch(
    () => props.data,
    async (data) => {
        if (!data) return
        const my = ++gen
        const doc = await getDocument({ data: data.slice() }).promise.catch(() => null)
        if (!doc) return
        if (my !== gen) return void doc.loadingTask.destroy()
        const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
        const contents = await Promise.all(pages.map((p) => p.getTextContent()))
        if (my !== gen) return void doc.loadingTask.destroy()
        const found = contents.map((tc, i) => {
            const [, y0, , y1] = pages[i].view
            return tc.items.filter(isText).map((it) => ({ str: it.str, y: 1 - (it.transform[5] - y0) / (y1 - y0) }))
        })
        const anchor = capture()
        const old = pdf
        pdf = doc
        texts = contents.map(cleanText)
        sheets.value = pages.map((p) => ({ w: p.view[2] - p.view[0], h: p.view[3] - p.view[1] }))
        spans.value = lineSpans(found)
        margin.value = Math.max(0, Math.min(...spans.value.map((s) => s.start.y), 0.5))
        await nextTick()
        if (anchor) restore(anchor)
        else reveal(props.line)
        redrawVisible()
        old?.loadingTask.destroy()
    },
    { immediate: true },
)

watch(scale, async () => {
    const anchor = capture()
    await nextTick()
    restore(anchor)
    redrawVisible()
})

function capture(): MarkSpot | null {
    const el = host.value
    if (!el || !pageEls.value.length) return null
    const top = el.scrollTop
    for (let i = 0; i < pageEls.value.length; i++) {
        const p = pageEls.value[i]
        if (p.offsetTop + p.offsetHeight + GAP > top) return { page: i, y: Math.max(0, (top - p.offsetTop) / p.offsetHeight) }
    }
    return null
}

function restore(a: MarkSpot | null) {
    if (a) scrollToSpot(a, 0)
}

function offsetOf(s: MarkSpot): number | null {
    const p = pageEls.value[s.page]
    return p ? p.offsetTop + s.y * p.offsetHeight : null
}

function scrollToSpot(s: MarkSpot, pad: number) {
    const el = host.value
    const top = offsetOf(s)
    if (el && top !== null) el.scrollTop = top - pad
}

const lines = computed(() => spans.value.map((s) => s.line))
function spanAt(line: number): LineSpan | null {
    const i = lastAtOrBefore(lines.value, line)
    return i < 0 ? null : spans.value[i]
}

const active = computed(() => spanAt(props.line))

function bands(page: number) {
    const s = active.value
    if (!s || page < s.start.page || page > s.end.page) return null
    const m = margin.value
    const top = page === s.start.page ? s.start.y : m
    const bottom = page === s.end.page ? s.end.y : 1 - m
    if (bottom <= top) return null
    const sh = sheets.value[page]
    const side = (m * sh.h) / sh.w
    return { top: `${top * 100}%`, height: `${(bottom - top) * 100}%`, left: `${side * 100}%`, right: `${side * 100}%` }
}

function reveal(line: number) {
    const s = spanAt(line)
    const el = host.value
    if (!s || !el) return
    const top = offsetOf(s.start)
    const bottom = offsetOf(s.end)
    if (top === null || bottom === null) return
    const view = el.scrollTop
    const end = view + el.clientHeight
    if (top >= view && bottom <= end) return
    el.scrollTop = top < view || bottom - top > el.clientHeight ? top - GAP : bottom - el.clientHeight + GAP
}

let followed: LineSpan | null = null
function follow(line: number) {
    const s = spanAt(line)
    if (!s || s === followed) return
    followed = s
    scrollToSpot(s.start, GAP)
}

function onClick(e: MouseEvent, page: number) {
    if (!window.getSelection()?.isCollapsed) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    let hit: LineSpan | null = null
    for (const s of spans.value) {
        const before = s.start.page < page || (s.start.page === page && s.start.y <= y)
        if (before && (!hit || s.start.page > hit.start.page || (s.start.page === hit.start.page && s.start.y >= hit.start.y))) hit = s
    }
    if (hit) emit('jump', hit.line)
}

async function draw(i: number) {
    const el = pageEls.value[i]
    const doc = pdf
    if (!el || !doc) return
    const key = `${gen}:${scale.value}`
    if (el.dataset.key === key) return
    el.dataset.key = key
    const page = await doc.getPage(i + 1)
    const viewport = page.getViewport({ scale: scale.value })
    const ratio = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width * ratio)
    canvas.height = Math.round(viewport.height * ratio)
    try {
        await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise
    } catch {
        return
    }
    if (el.dataset.key !== key) return
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    await new TextLayer({ textContentSource: texts[i], container: layer, viewport }).render()
    if (el.dataset.key !== key) return
    el.querySelector('canvas')?.remove()
    el.querySelector('.textLayer')?.remove()
    el.prepend(canvas)
    el.append(layer)
    snap(el)
}

function px(v: number): string {
    const r = window.devicePixelRatio || 1
    return `${Math.round(v * scale.value * r) / r}px`
}

function snap(el: HTMLElement) {
    const r = window.devicePixelRatio || 1
    el.style.translate = ''
    const box = el.getBoundingClientRect()
    const dx = (Math.round(box.left * r) - box.left * r) / r
    const dy = (Math.round(box.top * r) - box.top * r) / r
    if (dx || dy) el.style.translate = `${dx}px ${dy}px`
}

watch(room, () => nextTick(() => pageEls.value.forEach(snap)))

function redrawVisible() {
    for (const i of visible) void draw(i)
}

let io: IntersectionObserver | null = null
function observe() {
    io?.disconnect()
    if (!host.value) return
    io = new IntersectionObserver(
        (entries) => {
            for (const e of entries) {
                const i = Number((e.target as HTMLElement).dataset.page)
                if (e.isIntersecting) {
                    visible.add(i)
                    void draw(i)
                } else visible.delete(i)
            }
        },
        { root: host.value, rootMargin: '100% 0px' },
    )
    visible.clear()
    pageEls.value.forEach((el) => io!.observe(el))
}
watch(
    () => sheets.value.length,
    () => nextTick(observe),
    { flush: 'post' },
)
onBeforeUnmount(() => {
    io?.disconnect()
    gen++
    pdf?.loadingTask.destroy()
})

defineExpose({ reveal, follow })
</script>

<template>
    <div ref="host" class="pdf-pages" @copy="onCopy">
        <div
            v-for="(s, i) in sheets"
            :key="i"
            ref="pageEls"
            class="sheet"
            :data-page="i"
            :style="{ width: px(s.w), height: px(s.h), '--total-scale-factor': scale, '--scale-round-x': '1px', '--scale-round-y': '1px' }"
            @click="onClick($event, i)"
        >
            <div v-if="bands(i)" class="band" :style="bands(i)!" />
        </div>
    </div>
</template>

<style scoped>
.pdf-pages {
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 24px;
    padding: 24px;
}

.sheet {
    position: relative;
    flex-shrink: 0;
    margin-inline: auto;
    background: #fff;
    box-shadow: var(--cd-paper-shadow);
}

.sheet :deep(canvas) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.band {
    position: absolute;
    z-index: 1;
    background: rgb(255 214 0 / 0.28);
    mix-blend-mode: multiply;
    pointer-events: none;
}

.sheet :deep(.textLayer) {
    --min-font-size: 1;
    --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
    --min-font-size-inv: calc(1 / var(--min-font-size));
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: clip;
    text-align: initial;
    line-height: 1;
    letter-spacing: normal;
    word-spacing: normal;
    text-size-adjust: none;
    forced-color-adjust: none;
    transform-origin: 0 0;
    caret-color: CanvasText;
}

.sheet :deep(.textLayer :is(span, br)) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    user-select: text;
}

.sheet :deep(.textLayer > :not(.markedContent)),
.sheet :deep(.textLayer .markedContent span:not(.markedContent)) {
    --font-height: 0;
    --scale-x: 1;
    --rotate: 0deg;
    font-size: calc(var(--text-scale-factor) * var(--font-height));
    transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.sheet :deep(.textLayer .markedContent) {
    display: contents;
}

.sheet :deep(.textLayer ::selection) {
    background: rgb(0 90 255 / 0.25);
    color: transparent;
}
</style>
