<script setup lang="ts">
import { parseLegal } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { BODY_FONTS, cssFont, type DocStyle } from '@shared/prefs'
import { sourceLabel, type StyleOverride, type StyleSource } from '@shared/folder-style'
import { newDocText } from '@shared/doc-preset'

const props = defineProps<{
    modelValue: StyleOverride
    inherited: DocStyle
    from?: Record<keyof DocStyle, StyleSource>
    full?: boolean
    scopeName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [StyleOverride] }>()

const value = <K extends keyof DocStyle>(k: K): DocStyle[K] => (props.modelValue[k] ?? props.inherited[k]) as DocStyle[K]
const isSet = (k: keyof DocStyle) => props.full || props.modelValue[k] !== undefined
function set<K extends keyof DocStyle>(k: K, v: DocStyle[K]) {
    emit('update:modelValue', { ...props.modelValue, [k]: v })
}
function unset(k: keyof DocStyle) {
    const next = { ...props.modelValue }
    delete next[k]
    emit('update:modelValue', next)
}
function inheritNote(k: keyof DocStyle, text: string) {
    return `${sourceLabel(props.from?.[k] ?? 'app')}（${text}）を使っています`
}

const SIZES = [9, 10, 10.5, 11, 12].map((v) => ({ label: `${v}pt`, value: v }))
const LINES = [1.5, 1.6, 1.8, 2.0].map((v) => ({ label: `${v} 倍`, value: v }))
const MARGINS = [15, 20, 25, 30].map((v) => ({ label: `${v}mm`, value: v }))
const PRESET_LABEL = { law: '法令式', contract: '契約書式' } as const

const ROWS: { key: keyof DocStyle; label: string; desc?: string; show: (s: DocStyle) => string }[] = [
    { key: 'font', label: '本文のフォント', desc: 'プレビュー・PDF・Word で使用します。', show: (s) => s.font },
    { key: 'fontSize', label: '文字の大きさ', show: (s) => `${s.fontSize}pt` },
    { key: 'lineHeight', label: '行間', show: (s) => `${s.lineHeight} 倍` },
    { key: 'margin', label: '用紙の余白', show: (s) => `${s.margin}mm` },
    { key: 'pageNumbers', label: 'PDF にページ番号を入れる', desc: '例 [1 / 5]', show: (s) => (s.pageNumbers ? '入れる' : '入れない') },
    {
        key: 'newDocPreset',
        label: '新しい文書の書式',
        desc: '文書の名前に「契約」などが入っていれば、自動で契約書式にします。',
        show: (s) => PRESET_LABEL[s.newDocPreset],
    },
]

const effective = computed<DocStyle>(() => ({ ...props.inherited, ...props.modelValue }))

const SAMPLE = {
    law: newDocText(
        '〇〇に関する法律',
        'law',
        `## 総則
### 目的
- この法律は、〇〇に関し必要な事項を定めることを目的とする。
- この法律において、次の各号に掲げる用語の意義は、当該各号に定めるところによる。
  - 事業者
  - 利用者
`,
    ),
    contract: newDocText(
        '業務委託契約書',
        'contract',
        `### 目的
- 本契約は、甲が乙に委託する業務の内容及び条件を定めるものである。
- 乙は、次の業務を行う。
  - 調査及び報告
  - 資料の作成
`,
    ),
}
const sampleHtml = computed(() => renderDoc(parseLegal(SAMPLE[effective.value.newDocPreset])))
const sampleStyle = computed(() => ({
    '--cd-font': cssFont(effective.value.font),
    '--cd-size': `${effective.value.fontSize}pt`,
    '--cd-line': String(effective.value.lineHeight),
    padding: `${effective.value.margin / 2}mm`,
}))
</script>

<template>
    <div>
        <SettingRow
            v-for="r in ROWS"
            :key="r.key"
            :label="r.label"
            :description="isSet(r.key) ? r.desc : inheritNote(r.key, r.show(inherited))"
            :class="{ inherit: !isSet(r.key) }"
        >
            <template v-if="isSet(r.key)">
                <FontPicker
                    v-if="r.key === 'font'"
                    :model-value="value('font')"
                    :recommended="BODY_FONTS"
                    class="cd-w-input"
                    @update:model-value="(v) => set('font', v)"
                />
                <USelect
                    v-else-if="r.key === 'fontSize'"
                    :model-value="value('fontSize')"
                    :items="SIZES"
                    class="cd-w-small"
                    @update:model-value="(v: number) => set('fontSize', v)"
                />
                <USelect
                    v-else-if="r.key === 'lineHeight'"
                    :model-value="value('lineHeight')"
                    :items="LINES"
                    class="cd-w-small"
                    @update:model-value="(v: number) => set('lineHeight', v)"
                />
                <USelect
                    v-else-if="r.key === 'margin'"
                    :model-value="value('margin')"
                    :items="MARGINS"
                    class="cd-w-small"
                    @update:model-value="(v: number) => set('margin', v)"
                />
                <USwitch v-else-if="r.key === 'pageNumbers'" :model-value="value('pageNumbers')" @update:model-value="(v: boolean) => set('pageNumbers', v)" />
                <SegmentSwitch
                    v-else-if="r.key === 'newDocPreset'"
                    :model-value="value('newDocPreset')"
                    aria-label="新しい文書の書式"
                    :items="[
                        { value: 'law', label: PRESET_LABEL.law },
                        { value: 'contract', label: PRESET_LABEL.contract },
                    ]"
                    @update:model-value="(v) => v && set('newDocPreset', v)"
                />
                <UTooltip v-if="!full" :text="`${sourceLabel(from?.[r.key] ?? 'app')}に戻す`">
                    <UButton
                        icon="i-lucide-undo-2"
                        size="sm"
                        square
                        color="neutral"
                        variant="ghost"
                        :aria-label="`${r.label}を上の設定に戻す`"
                        @click="unset(r.key)"
                    />
                </UTooltip>
            </template>
            <UButton
                v-else
                :label="`${scopeName ?? 'ここ'}で変える`"
                icon="i-lucide-pencil"
                size="sm"
                color="neutral"
                variant="outline"
                @click="set(r.key, inherited[r.key])"
            />
        </SettingRow>
        <div class="sample cd-canvas">
            <div class="paper cd-paper" :style="sampleStyle" v-html="sampleHtml" />
        </div>
    </div>
</template>

<style scoped>
.inherit :deep(.label) {
    color: var(--ui-text-toned);
}

.sample {
    margin-top: 12px;
    padding: 16px;
    border-radius: 6px;
}

.paper {
    max-width: 520px;
    margin: 0 auto;
}
</style>
