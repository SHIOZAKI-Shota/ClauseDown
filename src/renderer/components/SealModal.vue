<script setup lang="ts">
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import type { SealMeta } from '@shared/api'
import { SEAL_COLOR, SIGN_INK, sealSvg, type SealStyle } from '@shared/seal'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import { imageToPng, pngUrl, svgToPng } from '~/utils/seal-image'

export interface SealInsert {
	png: Uint8Array
	label: string
	mark: 'seal' | 'sign' | null
	size: number
}

const props = defineProps<{ library?: boolean }>()
const emit = defineEmits<{ insert: [SealInsert]; saved: [] }>()
const open = defineModel<boolean>('open', { default: false })
const app = useApp()
const t = useT()
const m = computed(() => t.value.signing.sealModal)

type Tab = 'seal' | 'draw' | 'image' | 'library'
const tab = ref<Tab>('seal')
const tabs = computed<SegmentItem<Tab>[]>(() =>
	(['seal', 'draw', 'image', 'library'] as const)
		.filter((v) => v !== 'library' || (!props.library && saved.value.length))
		.map((value) => ({ value, label: m.value.tabs[value] })),
)

const name = ref(app.settings?.author.name?.split(/\s+/)[0] ?? '')
const style = ref<SealStyle>('kanji')
const sub = ref('')
const color = ref(SEAL_COLOR)
const styleItems = computed<SegmentItem<SealStyle>[]>(() => (['kanji', 'latin'] as const).map((value) => ({ value, label: m.value.styles[value] })))
const sealError = ref('')
const preview = computed(() => {
	sealError.value = ''
	if (!name.value.trim()) return ''
	try {
		return sealSvg({ text: name.value, style: style.value, color: color.value, sub: sub.value })
	} catch {
		sealError.value = m.value.tooMany
		return ''
	}
})
const previewUrl = computed(() => (preview.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.value)}` : ''))

const pad = ref<{ toPng: () => Promise<Uint8Array | null>; clear: () => void; undo: () => void; empty: boolean } | null>(null)
const inkColor = ref(SIGN_INK)

const fileBlob = ref<Blob | null>(null)
const transparent = ref(true)
const threshold = ref(225)
const imagePng = ref<Uint8Array | null>(null)
const imageUrl = ref('')
async function onFile(e: Event) {
	fileBlob.value = (e.target as HTMLInputElement).files?.[0] ?? null
	;(e.target as HTMLInputElement).value = ''
	await renderImage()
}
async function renderImage() {
	if (!fileBlob.value) return
	imagePng.value = await imageToPng(fileBlob.value, transparent.value, threshold.value)
	if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
	imageUrl.value = pngUrl(imagePng.value)
}
watch([transparent, threshold], renderImage)

const saved = ref<SealMeta[]>([])
const savedUrls = ref<Record<string, string>>({})
const picked = ref<SealMeta | null>(null)
async function loadSaved() {
	saved.value = (await window.api.listSeals().catch(() => [])) ?? []
	for (const s of saved.value) {
		if (savedUrls.value[s.id]) continue
		const png = await window.api.readSeal(s.id).catch(() => null)
		if (png) savedUrls.value = { ...savedUrls.value, [s.id]: pngUrl(png) }
	}
}
watch(open, (v) => v && void loadSaved(), { immediate: true })
onBeforeUnmount(() => {
	Object.values(savedUrls.value).forEach((u) => URL.revokeObjectURL(u))
	if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

const keep = ref(true)
const size = ref(15)
watch(tab, (v) => (size.value = v === 'draw' ? 12 : 15))

async function build(): Promise<{ png: Uint8Array; kind: SealMeta['kind']; label: string } | null> {
	if (tab.value === 'seal') {
		if (!preview.value) {
			app.notify(sealError.value || m.value.empty, true)
			return null
		}
		return { png: await svgToPng(preview.value), kind: 'seal', label: name.value.trim() }
	}
	if (tab.value === 'draw') {
		const png = await pad.value?.toPng()
		if (!png) {
			app.notify(m.value.nothingDrawn, true)
			return null
		}
		return { png, kind: 'sign', label: name.value.trim() }
	}
	if (tab.value === 'image') return imagePng.value ? { png: imagePng.value, kind: 'image', label: name.value.trim() } : null
	if (!picked.value) return null
	return { png: await window.api.readSeal(picked.value.id), kind: picked.value.kind, label: picked.value.label }
}

const busy = ref(false)
async function submit() {
	busy.value = true
	try {
		const made = await build()
		if (!made) return
		if ((props.library || keep.value) && tab.value !== 'library') {
			await app.run(() => window.api.saveSeal({ kind: made.kind, label: made.label }, made.png))
			emit('saved')
		}
		if (!props.library)
			emit('insert', {
				png: made.png,
				label: made.label || t.value.signing.seals.kinds[made.kind],
				mark: made.kind === 'sign' ? 'sign' : 'seal',
				size: size.value,
			})
		open.value = false
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<UModal v-model:open="open" :title="m.title" :ui="{ content: 'max-w-xl' }">
		<template #body>
			<div class="seal-modal">
				<SegmentSwitch v-model="tab" :items="tabs" />

				<template v-if="tab === 'seal'">
					<div class="grid">
						<div class="fields">
							<UFormField :label="m.name" :help="m.nameHint">
								<UInput v-model="name" autofocus />
							</UFormField>
							<UFormField :label="m.style">
								<SegmentSwitch v-model="style" :items="styleItems" size="xs" />
							</UFormField>
							<UFormField v-if="style === 'latin'" :label="m.sub">
								<UInput v-model="sub" />
							</UFormField>
							<UFormField :label="m.color">
								<input v-model="color" type="color" class="color" />
							</UFormField>
						</div>
						<div class="preview">
							<img v-if="previewUrl" :src="previewUrl" alt="" />
							<span v-else class="cd-muted">{{ sealError || m.empty }}</span>
						</div>
					</div>
				</template>

				<template v-else-if="tab === 'draw'">
					<p class="cd-muted hint">{{ m.drawHint }}</p>
					<SignaturePad ref="pad" :color="inkColor" />
					<div class="row">
						<UButton :label="m.undo" size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" @click="pad?.undo()" />
						<UButton :label="m.clear" size="xs" color="neutral" variant="ghost" icon="i-lucide-eraser" @click="pad?.clear()" />
						<input v-model="inkColor" type="color" class="color" :aria-label="m.color" />
					</div>
				</template>

				<template v-else-if="tab === 'image'">
					<div class="grid">
						<div class="fields">
							<label class="pick">
								<input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFile" />
								<UButton as="span" :label="m.pick" size="sm" color="neutral" variant="outline" icon="i-lucide-image-up" />
							</label>
							<USwitch v-model="transparent" :label="m.transparent" />
							<UFormField v-if="transparent" :label="m.threshold">
								<USlider v-model="threshold" :min="150" :max="250" />
							</UFormField>
						</div>
						<div class="preview checker">
							<img v-if="imageUrl" :src="imageUrl" alt="" />
						</div>
					</div>
				</template>

				<template v-else>
					<div class="library">
						<button v-for="s in saved" :key="s.id" type="button" class="saved" :class="{ on: picked?.id === s.id }" @click="picked = s">
							<img v-if="savedUrls[s.id]" :src="savedUrls[s.id]" :alt="s.label" />
							<span>{{ s.label || t.signing.seals.kinds[s.kind] }}</span>
						</button>
					</div>
				</template>

				<div v-if="!library" class="row options">
					<UFormField :label="m.size">
						<UInput v-model.number="size" type="number" min="5" max="40" class="cd-w-small" />
					</UFormField>
					<USwitch v-if="tab !== 'library'" v-model="keep" :label="m.saveToLibrary" />
				</div>
			</div>
		</template>
		<template #footer>
			<div class="cd-modal-foot">
				<UButton :label="t.common.cancel" color="neutral" variant="outline" @click="open = false" />
				<UButton :label="library ? m.saveOnly : m.insert" :loading="busy" @click="submit" />
			</div>
		</template>
	</UModal>
</template>

<style scoped>
.seal-modal {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.grid {
	display: grid;
	grid-template-columns: 1fr 180px;
	gap: 16px;
	align-items: start;
}
.fields {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.preview {
	display: grid;
	place-items: center;
	width: 180px;
	height: 180px;
	border: 1px solid var(--ui-border);
	border-radius: 6px;
}
.preview img {
	max-width: 160px;
	max-height: 160px;
}
.checker {
	background-image: conic-gradient(var(--ui-bg-elevated) 25%, transparent 0 50%, var(--ui-bg-elevated) 0 75%, transparent 0);
	background-size: 16px 16px;
}
.color {
	width: 36px;
	height: 24px;
	padding: 0;
	border: 1px solid var(--ui-border);
	border-radius: 4px;
	background: none;
}
.row {
	display: flex;
	align-items: center;
	gap: 12px;
}
.options {
	justify-content: space-between;
	border-top: 1px solid var(--ui-border);
	padding-top: 12px;
}
.hint {
	font-size: 12px;
	margin: 0;
}
.pick {
	display: inline-block;
}
.library {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}
.saved {
	width: 104px;
	padding: 8px;
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	background: none;
	font-size: 12px;
	cursor: pointer;
}
.saved.on {
	border-color: var(--ui-primary);
	box-shadow: 0 0 0 1px var(--ui-primary);
}
.saved img {
	display: block;
	width: 100%;
	height: 64px;
	object-fit: contain;
}
</style>
