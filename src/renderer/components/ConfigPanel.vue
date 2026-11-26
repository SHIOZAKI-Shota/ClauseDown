<script setup lang="ts">
import { computed } from 'vue'
import { CONFIG_CHOICES, getConfigValue, presetOf, setConfigValue, type ConfigKey, type DocConfig } from '@shared/config'
import { STYLE_NAMES, type StyleId } from '@shared/legal-styles'
import { useT } from '~/composables/useT'

const t = useT()
const props = defineProps<{ config: DocConfig; warnings: string[]; styleId?: StyleId }>()
const emit = defineEmits<{ change: [DocConfig]; preset: ['law' | 'contract']; close: [] }>()

type Group = 'chapter' | 'article' | 'paragraph' | 'item'
const COLUMNS: { id: Group; keys: ConfigKey[] }[][] = [
	[
		{ id: 'chapter', keys: ['chapter.numeral'] },
		{ id: 'article', keys: ['article.numeral', 'article.title', 'article.numbering'] },
	],
	[{ id: 'paragraph', keys: ['paragraph.firstNumbered', 'paragraph.numeral', 'paragraph.indent', 'paragraph.hang'] }],
	[{ id: 'item', keys: ['item.style', 'subitem.style'] }],
]

const japanese = computed(() => (props.styleId ?? 'ja') === 'ja')
const current = computed(() => presetOf(props.config))
const itemsOf = (key: ConfigKey) => Object.entries(CONFIG_CHOICES[key].options).map(([value, label]) => ({ value, label: label as string }))
const styleItems = computed(() =>
	itemsOf('doc.style').map((i) => (i.value === 'auto' && props.styleId ? { ...i, label: t.value.editor.config.styleAuto(STYLE_NAMES[props.styleId]) } : i)),
)
const PRESETS = computed(() => [
	{ id: 'law' as const, label: t.value.editor.config.law, sample: t.value.editor.config.lawSample },
	{ id: 'contract' as const, label: t.value.editor.config.contract, sample: t.value.editor.config.contractSample },
])

function update(key: ConfigKey, value: string | undefined) {
	if (value !== undefined) emit('change', setConfigValue(props.config, key, value))
}
</script>

<template>
	<aside class="cfg" :aria-label="t.editor.config.title">
		<div class="head">
			<span class="title">{{ t.editor.config.title }}</span>
			<UButton icon="i-lucide-x" size="xs" square color="neutral" variant="ghost" :aria-label="t.editor.config.close" @click="emit('close')" />
		</div>
		<div class="scroll">
			<div class="col">
				<section class="group">
					<h3>{{ t.editor.config.groups.style }}</h3>
					<USelect
						:model-value="getConfigValue(config, 'doc.style')"
						:items="styleItems"
						size="sm"
						class="cd-full"
						@update:model-value="(v: string) => update('doc.style', v)"
					/>
					<div v-if="styleId === 'contract'" class="field">
						<span class="label">{{ t.editor.config.fields['doc.contractType'] }}</span>
						<SegmentSwitch
							:model-value="String(getConfigValue(config, 'doc.contractType'))"
							:items="itemsOf('doc.contractType')"
							size="xs"
							@update:model-value="(v) => update('doc.contractType', v)"
						/>
					</div>
				</section>

				<template v-if="japanese">
					<section class="group">
						<h3>{{ t.editor.config.presets }}</h3>
						<div class="presets">
							<button
								v-for="p in PRESETS"
								:key="p.id"
								type="button"
								class="preset"
								:class="{ on: current === p.id }"
								:aria-pressed="current === p.id"
								@click="emit('preset', p.id)"
							>
								<span class="p-head">
									<span class="p-name">{{ p.label }}</span>
									<span v-if="current === p.id" class="p-badge">{{ t.editor.config.inUse }}</span>
								</span>
								<span class="p-sample">{{ p.sample }}</span>
							</button>
						</div>
						<p v-if="!current" class="cd-muted note">{{ t.editor.config.custom }}</p>
					</section>
				</template>
				<p v-else class="cd-muted note">{{ t.editor.config.jaOnlyShort }}</p>
				<UAlert
					v-if="warnings.length"
					color="error"
					variant="subtle"
					:description="warnings.join(t.editor.config.warnSep)"
					:title="t.editor.config.invalid"
				/>
			</div>
			<template v-if="japanese">
				<div v-for="(col, ci) in COLUMNS" :key="ci" class="col">
					<section v-for="g in col" :key="g.id" class="group">
						<h3>{{ t.editor.config.groups[g.id] }}</h3>
						<div v-for="key in g.keys" :key="key" class="field">
							<span class="label">{{ t.editor.config.fields[key as keyof typeof t.editor.config.fields] }}</span>
							<SegmentSwitch
								:model-value="String(getConfigValue(config, key))"
								:items="itemsOf(key)"
								size="xs"
								:aria-label="CONFIG_CHOICES[key].label"
								@update:model-value="(v) => update(key, v)"
							/>
						</div>
					</section>
				</div>
			</template>
		</div>
	</aside>
</template>

<style scoped>
.cfg {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 6;
	display: flex;
	flex-direction: column;
	max-height: min(60%, 520px);
	border-top: 1px solid var(--ui-border);
	background: var(--ui-bg);
	box-shadow: 0 -10px 30px rgb(0 0 0 / 0.08);
}

.head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 36px;
	flex: none;
	padding: 0 8px 0 16px;
	border-bottom: 1px solid var(--ui-border);
}

.title {
	font-size: 13px;
	font-weight: 600;
}

.scroll {
	flex: 1;
	min-height: 0;
	overflow: auto;
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	align-items: start;
	padding: 0 0 16px;
}

.col {
	display: flex;
	flex-direction: column;
	min-width: 0;
	padding: 0 20px;
}

.col + .col {
	border-left: 1px solid var(--ui-border);
}

.group {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px 0;
}

.group + .group {
	border-top: 1px solid var(--ui-border);
}

h3 {
	margin: 0;
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	color: var(--ui-text-muted);
}

.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.label {
	font-size: 12px;
	color: var(--ui-text);
}

.presets {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}

.preset {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border: 1px solid var(--ui-border);
	border-radius: 6px;
	background: var(--ui-bg);
	color: var(--ui-text);
	text-align: left;
	cursor: pointer;
}

.preset:hover {
	border-color: var(--ui-border-accented);
}

.preset.on {
	border-color: var(--ui-color-primary-500);
	background: color-mix(in oklab, var(--ui-color-primary-500) 6%, var(--ui-bg));
}

.p-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
}

.p-name {
	font-size: 13px;
	font-weight: 600;
}

.p-badge {
	font-size: 10px;
	color: var(--ui-color-primary-500);
}

.p-sample {
	font-family: var(--cd-font, serif);
	font-size: 11px;
	color: var(--ui-text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.note {
	margin: 0;
	font-size: 12px;
}

@media (max-width: 1100px) {
	.scroll {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.col:nth-child(3) {
		border-left: 0;
	}
}
</style>
