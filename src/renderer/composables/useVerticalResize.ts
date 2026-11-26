import { useStoredRef } from '~/composables/useStoredRef'

export function useVerticalResize(key: string, initial: number, o: { min: number; max: () => number; grow: 'up' | 'down' }) {
	const height = useStoredRef(key, initial, { delay: 300 })
	const dragging = ref(false)
	let startY = 0
	let startH = 0
	function down(e: PointerEvent) {
		if (e.button !== 0) return
		e.preventDefault()
		startY = e.clientY
		startH = height.value
		dragging.value = true
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		document.body.classList.add('cd-resizing-v')
	}
	function move(e: PointerEvent) {
		if (!dragging.value) return
		const delta = (e.clientY - startY) * (o.grow === 'up' ? -1 : 1)
		height.value = Math.round(Math.min(Math.max(o.min, o.max()), Math.max(o.min, startH + delta)))
	}
	function up() {
		dragging.value = false
		document.body.classList.remove('cd-resizing-v')
	}
	onBeforeUnmount(up)
	const reset = () => (height.value = initial)
	return { height, dragging, down, move, up, reset }
}
