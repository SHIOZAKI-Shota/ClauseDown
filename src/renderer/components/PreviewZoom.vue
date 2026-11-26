<script setup lang="ts">
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
function setPreviewZoom(v: number | number[] | null | undefined) {
	const n = Number(Array.isArray(v) ? v[0] : v)
	if (!Number.isFinite(n)) return
	const next = clamp(Math.round(n), 50, 200)
	const steps = app.prefs.zoomLinked ? Math.round((next - app.prefs.previewZoom) / 10) : 0
	app.setPrefsLive({ previewZoom: next, editorFontSize: clamp(app.prefs.editorFontSize + steps, 10, 28) })
}
</script>

<template>
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
</template>

<style scoped>
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

@container preview (max-width: 560px) {
	.zoom-slider {
		display: none;
	}
}

.zoom-unit {
	font-size: 12px;
	color: var(--ui-text-muted);
}
</style>
