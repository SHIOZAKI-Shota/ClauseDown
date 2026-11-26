<script setup lang="ts">
import { BODY_FONTS, cssFont } from '@shared/prefs'
import { parseProps, propsStyle } from '@shared/cd-prop'
import { useT } from '~/composables/useT'

const t = useT()
const props = defineProps<{ sample: string; inline: boolean; canInline: boolean }>()
const emit = defineEmits<{ close: []; apply: [{ open: string; close: string; mode: 'inline' | 'lines'; onlyBreak: boolean }] }>()

const mode = ref<'inline' | 'lines'>(props.inline ? 'inline' : 'lines')
const size = ref<number | null>(null)
const font = ref('')
const align = ref<'none' | 'left' | 'center' | 'right'>('none')
const lineHeight = ref<number | null>(null)
const cols = ref('')
const pageBreak = ref(false)

const MODES = computed(() => [
	{ value: 'inline' as const, label: t.value.editor.prop.inline, icon: 'i-lucide-text-cursor', disabled: !props.canInline },
	{ value: 'lines' as const, label: t.value.editor.prop.lines, icon: 'i-lucide-text' },
])
const ALIGNS = computed(() => [
	{ value: 'none' as const, label: t.value.editor.prop.none },
	{ value: 'left' as const, icon: 'i-lucide-align-left', tooltip: t.value.editor.prop.left },
	{ value: 'center' as const, icon: 'i-lucide-align-center', tooltip: t.value.editor.prop.center },
	{ value: 'right' as const, icon: 'i-lucide-align-right', tooltip: t.value.editor.prop.right },
])
const lines = computed(() => mode.value === 'lines')
const colsOk = computed(() => !cols.value.trim() || /^\s*\d+(\.\d+)?(%|mm)?(\s*,\s*\d+(\.\d+)?(%|mm)?)*\s*$/.test(cols.value))

const attrs = computed(() => {
	const out: string[] = []
	if (size.value) out.push(`size=${size.value}pt`)
	const f = font.value.trim().replace(/["{}]/g, '')
	if (f) out.push(/\s/.test(f) ? `font="${f}"` : `font=${f}`)
	if (lines.value) {
		if (align.value !== 'none') out.push(align.value)
		if (lineHeight.value) out.push(`line=${lineHeight.value}`)
		if (cols.value.trim() && colsOk.value) out.push(`cols=${cols.value.replace(/\s+/g, '')}`)
		if (pageBreak.value) out.push('break')
	}
	return out
})
const onlyBreak = computed(() => attrs.value.length === 1 && attrs.value[0] === 'break')
const brace = computed(() => `{${attrs.value.join(' ')}}`)
const tag = computed(() => (onlyBreak.value ? '{break}' : lines.value ? `::: ${brace.value}` : `[…]${brace.value}`))
const ready = computed(() => attrs.value.length > 0 && colsOk.value)
const previewStyle = computed(() => {
	const p = parseProps(attrs.value.join(' '))
	const style = propsStyle({ ...p, break: undefined, fontFamily: undefined })
	return `${style};${p.fontFamily ? `font-family:${cssFont(p.fontFamily)}` : ''}`
})
const sampleText = computed(() => (props.sample.trim() || t.value.editor.prop.sampleText).slice(0, 120))

function apply() {
	if (!ready.value) return
	if (onlyBreak.value) emit('apply', { open: '{break}', close: '', mode: 'lines', onlyBreak: true })
	else if (lines.value) emit('apply', { open: `::: ${brace.value}`, close: ':::', mode: 'lines', onlyBreak: false })
	else emit('apply', { open: '[', close: `]${brace.value}`, mode: 'inline', onlyBreak: false })
}
</script>

<template>
	<UModal :open="true" :title="t.editor.prop.title" @update:open="(v) => !v && emit('close')">
		<template #body>
			<div class="form">
				<UFormField :label="t.editor.prop.scope">
					<SegmentSwitch v-model="mode" :items="MODES" :aria-label="t.editor.prop.scope" />
				</UFormField>
				<div class="row">
					<UFormField :label="t.editor.prop.size" class="cd-grow">
						<UInputNumber v-model="size" :min="5" :max="40" :step="0.5" :placeholder="t.editor.prop.none" />
					</UFormField>
					<UFormField v-if="lines" :label="t.editor.prop.lineHeight" class="cd-grow">
						<UInputNumber v-model="lineHeight" :min="0.8" :max="4" :step="0.1" :placeholder="t.editor.prop.none" />
					</UFormField>
				</div>
				<UFormField :label="t.editor.prop.font">
					<FontPicker v-model="font" :recommended="BODY_FONTS" class="w-full" />
				</UFormField>
				<template v-if="lines">
					<UFormField :label="t.editor.prop.align">
						<SegmentSwitch v-model="align" :items="ALIGNS" :aria-label="t.editor.prop.align" />
					</UFormField>
					<UFormField :label="t.editor.prop.cols" :error="colsOk ? undefined : t.editor.prop.colsError">
						<UInput v-model="cols" :placeholder="t.editor.prop.colsPlaceholder" class="w-full" />
					</UFormField>
					<USwitch v-model="pageBreak" :label="t.editor.prop.pageBreak" />
				</template>
				<div class="preview">
					<p class="cd-muted cap">{{ t.editor.prop.sample }}</p>
					<p class="sample" :style="previewStyle">{{ sampleText }}</p>
				</div>
				<code v-if="ready" class="tag">{{ tag }}</code>
			</div>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
				<UButton :label="onlyBreak ? t.editor.prop.insertBreak : t.editor.prop.wrap" :disabled="!ready" @click="apply" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.form {
	display: flex;
	flex-direction: column;
	gap: 14px;
}

.row {
	display: flex;
	gap: 12px;
}

.preview {
	border: 1px solid var(--ui-border);
	border-radius: 8px;
	padding: 8px 12px;
	background: var(--cd-paper);
	color: var(--cd-ink);
}

.cap {
	margin: 0 0 4px;
	font-size: 11px;
}

.sample {
	margin: 0;
	font-family: var(--cd-font);
	font-size: 10.5pt;
	line-height: 1.8;
	overflow-wrap: anywhere;
}

.tag {
	font-size: 12px;
	color: var(--ui-text-muted);
	overflow-wrap: anywhere;
}
</style>
