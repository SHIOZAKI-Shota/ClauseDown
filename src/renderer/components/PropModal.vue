<script setup lang="ts">
import { BODY_FONTS, cssFont } from '@shared/prefs'
import { parseProps, propsStyle } from '@shared/cd-prop'

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
    { value: 'inline' as const, label: '選んだ文字だけ', icon: 'i-lucide-text-cursor', disabled: !props.canInline },
    { value: 'lines' as const, label: '行ごと（条・項・表など）', icon: 'i-lucide-text' },
])
const ALIGNS = [
    { value: 'none' as const, label: '指定なし' },
    { value: 'left' as const, icon: 'i-lucide-align-left', tooltip: '左寄せ' },
    { value: 'center' as const, icon: 'i-lucide-align-center', tooltip: '中央寄せ' },
    { value: 'right' as const, icon: 'i-lucide-align-right', tooltip: '右寄せ' },
]
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
const sampleText = computed(() => (props.sample.trim() || '本文の例').slice(0, 120))

function apply() {
    if (!ready.value) return
    if (onlyBreak.value) emit('apply', { open: '{break}', close: '', mode: 'lines', onlyBreak: true })
    else if (lines.value) emit('apply', { open: `::: ${brace.value}`, close: ':::', mode: 'lines', onlyBreak: false })
    else emit('apply', { open: '[', close: `]${brace.value}`, mode: 'inline', onlyBreak: false })
}
</script>

<template>
    <UModal :open="true" title="書式を付ける"
        @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="form">
                <UFormField label="付ける範囲">
                    <SegmentSwitch v-model="mode" :items="MODES" aria-label="付ける範囲" />
                </UFormField>
                <div class="row">
                    <UFormField label="文字の大きさ（pt）" class="grow">
                        <UInputNumber v-model="size" :min="5" :max="40" :step="0.5" placeholder="指定なし" />
                    </UFormField>
                    <UFormField v-if="lines" label="行の高さ（倍）" class="grow">
                        <UInputNumber v-model="lineHeight" :min="0.8" :max="4" :step="0.1" placeholder="指定なし" />
                    </UFormField>
                </div>
                <UFormField label="フォント">
                    <FontPicker v-model="font" :recommended="BODY_FONTS" class="w-full" />
                </UFormField>
                <template v-if="lines">
                    <UFormField label="寄せ">
                        <SegmentSwitch v-model="align" :items="ALIGNS" aria-label="寄せ" />
                    </UFormField>
                    <UFormField label="表の列の幅"
                        :error="colsOk ? undefined : '25,75 のように、数字をカンマで区切って書いてください'">
                        <UInput v-model="cols" placeholder="例：25,75" class="w-full" />
                    </UFormField>
                    <USwitch v-model="pageBreak" label="この前で改ページする" />
                </template>
                <div class="preview">
                    <p class="cd-muted cap">見本</p>
                    <p class="sample" :style="previewStyle">{{ sampleText }}</p>
                </div>
                <code v-if="ready" class="tag">{{ tag }}</code>
            </div>
        </template>
        <template #footer>
            <div class="foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="onlyBreak ? '改ページを入れる' : '囲む'" :disabled="!ready" @click="apply" />
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

.grow {
    flex: 1;
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

.foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    width: 100%;
}
</style>
