<script setup lang="ts">
import { CONFIG_CHOICES, getConfigValue, setConfigValue, type ConfigKey, type DocConfig } from '@shared/config'

const props = defineProps<{ config: DocConfig; warnings: string[] }>()
const emit = defineEmits<{ change: [DocConfig]; preset: ['law' | 'contract'] }>()

const keys = Object.keys(CONFIG_CHOICES) as ConfigKey[]
const itemsOf = (key: ConfigKey) => Object.entries(CONFIG_CHOICES[key].options).map(([value, label]) => ({ value, label: label as string }))

function update(key: ConfigKey, value: string) {
    emit('change', setConfigValue(props.config, key, value))
}
</script>

<template>
    <div class="panel">
        <div class="presets">
            <span class="cd-muted">まとめて設定：</span>
            <UButton label="法令式" size="xs" color="neutral" variant="outline" @click="emit('preset', 'law')" />
            <UButton label="契約書式" size="xs" color="neutral" variant="outline" @click="emit('preset', 'contract')" />
        </div>
        <div class="grid">
            <UFormField v-for="key in keys" :key="key" :label="CONFIG_CHOICES[key].label" size="sm">
                <USelect
                    :model-value="getConfigValue(config, key)"
                    :items="itemsOf(key)"
                    size="sm"
                    class="cd-full"
                    @update:model-value="(v: string) => update(key, v)"
                />
            </UFormField>
        </div>
        <UAlert v-if="warnings.length" color="error" variant="subtle" :description="warnings.join(' ／ ')" title="設定に誤りがあります" />
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

.grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px 12px;
}
</style>
