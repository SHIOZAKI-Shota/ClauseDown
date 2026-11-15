<script setup lang="ts">
import { computed } from 'vue'
import { CONFIG_CHOICES, getConfigValue, JA_ONLY_KEYS, setConfigValue, type ConfigKey, type DocConfig } from '@shared/config'
import { STYLE_NAMES, type StyleId } from '@shared/legal-styles'
import { useT } from '~/composables/useT'

const t = useT()
const props = defineProps<{ config: DocConfig; warnings: string[]; styleId?: StyleId }>()
const emit = defineEmits<{ change: [DocConfig]; preset: ['law' | 'contract'] }>()

const keys = Object.keys(CONFIG_CHOICES) as ConfigKey[]
const itemsOf = (key: ConfigKey) =>
    Object.entries(CONFIG_CHOICES[key].options).map(([value, label]) => ({
        value,
        label: key === 'doc.style' && value === 'auto' && props.styleId ? t.value.editor.config.styleAuto(STYLE_NAMES[props.styleId]) : (label as string),
    }))
const japanese = computed(() => (props.styleId ?? 'ja') === 'ja')
const disabled = (key: ConfigKey) => (key === 'doc.contractType' ? props.styleId !== 'contract' : !japanese.value && JA_ONLY_KEYS.includes(key))

function update(key: ConfigKey, value: string) {
    emit('change', setConfigValue(props.config, key, value))
}
</script>

<template>
    <div class="panel">
        <div class="presets">
            <span class="cd-muted">{{ t.editor.config.presets }}</span>
            <UButton :label="t.editor.config.law" size="xs" color="neutral" variant="outline" :disabled="!japanese" @click="emit('preset', 'law')" />
            <UButton :label="t.editor.config.contract" size="xs" color="neutral" variant="outline" :disabled="!japanese" @click="emit('preset', 'contract')" />
            <span v-if="!japanese" class="cd-muted">{{ t.editor.config.jaOnly }}</span>
        </div>
        <div class="grid">
            <UFormField v-for="key in keys" :key="key" :label="CONFIG_CHOICES[key].label" size="sm" :class="{ off: disabled(key) }">
                <USelect
                    :model-value="getConfigValue(config, key)"
                    :items="itemsOf(key)"
                    size="sm"
                    class="cd-full"
                    :disabled="disabled(key)"
                    @update:model-value="(v: string) => update(key, v)"
                />
            </UFormField>
        </div>
        <UAlert v-if="warnings.length" color="error" variant="subtle" :description="warnings.join(t.editor.config.warnSep)" :title="t.editor.config.invalid" />
    </div>
</template>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-muted);
}

.presets {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
}

.off {
    opacity: 0.45;
}

.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px 12px;
}
</style>
