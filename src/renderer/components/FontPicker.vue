<script setup lang="ts">
import { cssFont } from '@shared/prefs'

const props = defineProps<{ modelValue: string; recommended: string[]; kind?: 'serif' | 'mono' }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const installed = useInstalledFonts()

const JA = /[぀-ヿ㐀-鿿＀-￯]/
const items = computed(() => {
    const all = installed.value
    const has = new Set(all)
    const top = all.length ? props.recommended.filter((f) => has.has(f)) : [...props.recommended]
    const topSet = new Set(top)
    const rest = all.filter((f) => !topSet.has(f))
    const byName = (a: string, b: string) => a.localeCompare(b, 'ja')
    const ja = rest.filter((f) => JA.test(f)).sort(byName)
    const other = rest.filter((f) => !JA.test(f)).sort(byName)
    if (props.modelValue && !topSet.has(props.modelValue) && !has.has(props.modelValue)) top.unshift(props.modelValue)
    return [top, ja, other].filter((g) => g.length)
})

const family = (name: string) => cssFont(name, props.kind)
</script>

<script lang="ts">
// pwsh
const fonts = ref<string[]>([])
let asked = false
function useInstalledFonts() {
    if (!asked) {
        asked = true
        window.api.listFonts().then((r) => (fonts.value = r)).catch(() => { })
    }
    return fonts
}
</script>

<template>
    <UInputMenu :model-value="modelValue" :items="items" create-item open-on-click
        :style="{ fontFamily: family(modelValue) }" :ui="{ content: 'cd-font-menu' }"
        @update:model-value="(v: string) => v && emit('update:modelValue', v)"
        @create="(v: string) => emit('update:modelValue', v)">
        <template #item-label="{ item }">
            <span :style="{ fontFamily: family(String(item)) }">{{ item }}</span>
        </template>
    </UInputMenu>
</template>

<style>
.cd-font-menu {
    max-height: 420px;
    min-width: 340px;
}

.cd-font-menu [role='option'] {
    font-size: 15px;
}
</style>
