<script setup lang="ts">
import { getStroke } from 'perfect-freehand'
import { canvasPng } from '~/utils/seal-image'
import { SIGN_INK } from '@shared/seal'

const props = withDefaults(defineProps<{ color?: string }>(), { color: SIGN_INK })
const canvas = ref<HTMLCanvasElement | null>(null)
const strokes = ref<number[][][]>([])
let current: number[][] | null = null

const OPTIONS = { size: 6, thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true }

function outline(points: number[][], pen: boolean) {
	return getStroke(points, { ...OPTIONS, simulatePressure: !pen })
}

function pathOf(poly: number[][]): Path2D {
	const p = new Path2D()
	if (!poly.length) return p
	p.moveTo(poly[0][0], poly[0][1])
	for (let i = 1; i < poly.length; i++) {
		const [x0, y0] = poly[i - 1]
		const [x1, y1] = poly[i]
		p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
	}
	p.closePath()
	return p
}

const polys = () =>
	strokes.value.map((s) =>
		outline(
			s,
			s.some((pt) => pt[2] !== 0.5),
		),
	)

function draw() {
	const c = canvas.value
	if (!c) return
	const ctx = c.getContext('2d')!
	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.clearRect(0, 0, c.width, c.height)
	const ratio = c.width / c.clientWidth
	ctx.scale(ratio, ratio)
	ctx.fillStyle = props.color
	for (const poly of polys()) ctx.fill(pathOf(poly))
	if (current)
		ctx.fill(
			pathOf(
				outline(
					current,
					current.some((pt) => pt[2] !== 0.5),
				),
			),
		)
}

function resize() {
	const c = canvas.value
	if (!c) return
	const ratio = window.devicePixelRatio || 1
	c.width = Math.round(c.clientWidth * ratio)
	c.height = Math.round(c.clientHeight * ratio)
	draw()
}

function point(e: PointerEvent): number[] {
	const r = canvas.value!.getBoundingClientRect()
	return [e.clientX - r.left, e.clientY - r.top, e.pointerType === 'pen' ? e.pressure : 0.5]
}
function down(e: PointerEvent) {
	canvas.value!.setPointerCapture(e.pointerId)
	current = [point(e)]
	draw()
}
function move(e: PointerEvent) {
	if (!current) return
	for (const ev of e.getCoalescedEvents?.() ?? [e]) current.push(point(ev))
	draw()
}
function up() {
	if (current && current.length) strokes.value = [...strokes.value, current]
	current = null
	draw()
}

function clear() {
	strokes.value = []
	draw()
}
function undo() {
	strokes.value = strokes.value.slice(0, -1)
	draw()
}

async function toPng(scale = 3): Promise<Uint8Array | null> {
	const all = polys()
	if (!all.length) return null
	const pts = all.flat()
	const pad = 6
	const minX = Math.min(...pts.map((p) => p[0])) - pad
	const minY = Math.min(...pts.map((p) => p[1])) - pad
	const maxX = Math.max(...pts.map((p) => p[0])) + pad
	const maxY = Math.max(...pts.map((p) => p[1])) + pad
	const out = document.createElement('canvas')
	out.width = Math.ceil((maxX - minX) * scale)
	out.height = Math.ceil((maxY - minY) * scale)
	const ctx = out.getContext('2d')!
	ctx.scale(scale, scale)
	ctx.translate(-minX, -minY)
	ctx.fillStyle = props.color
	for (const poly of all) ctx.fill(pathOf(poly))
	return canvasPng(out)
}

const empty = computed(() => !strokes.value.length)
defineExpose({ clear, undo, toPng, empty })

let observer: ResizeObserver | null = null
onMounted(() => {
	resize()
	observer = new ResizeObserver(resize)
	if (canvas.value) observer.observe(canvas.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.color, draw)
</script>

<template>
	<canvas ref="canvas" class="pad" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerleave="up" />
</template>

<style scoped>
.pad {
	width: 100%;
	height: 180px;
	border: 1px dashed var(--ui-border-accented);
	border-radius: 6px;
	background: var(--ui-bg);
	touch-action: none;
	cursor: crosshair;
}
</style>
