<script setup lang="ts">
import { useApp } from '~/stores/app'

export interface SettingsNavItem {
    id: string
    label: string
    icon: string
}

const props = defineProps<{
    sections: SettingsNavItem[]
    title: string
    scope: string
    note: string
    saved: boolean
    idPrefix: string
    stackedHead?: boolean
}>()

const app = useApp()
const where = props.idPrefix === 'r' ? 'repo' : 'setup'

const active = computed({
    get: () => {
        const t = app.settingsTab[where]
        return props.sections.some((s) => s.id === t) ? t! : (props.sections[0]?.id ?? '')
    },
    set: (id: string) => (app.settingsTab[where] = id),
})
provide('settingsIdPrefix', props.idPrefix)
provide('settingsActive', active)

const body = ref<HTMLElement>()
watch(active, () => body.value?.scrollTo({ top: 0 }))
</script>

<template>
    <div class="settings">
        <aside class="index">
            <button class="back" @click="app.goBack()">
                <UIcon name="i-lucide-arrow-left" />{{ app.returnLabel }}
            </button>
            <div class="index-head" :class="{ stacked: stackedHead }">{{ title }}<span class="scope">{{ scope }}</span>
            </div>
            <div role="tablist" aria-orientation="vertical" class="tabs">
                <button v-for="s in sections" :key="s.id" role="tab" :aria-selected="active === s.id"
                    :class="{ on: active === s.id }" @click="active = s.id">
                    <UIcon :name="s.icon" />{{ s.label }}
                </button>
            </div>
            <p class="note">{{ note }}</p>
        </aside>

        <div ref="body" class="body" role="tabpanel">
            <div class="inner">
                <div class="saved" :class="{ show: saved }">
                    <UIcon name="i-lucide-check" />保存しました
                </div>
                <slot />
            </div>
        </div>
    </div>
</template>

<style scoped>
.settings {
    display: flex;
    height: 100%;
}

.index {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--ui-border);
    background: var(--cd-sidebar);
    padding: 16px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.index .back {
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.index .back:hover {
    color: var(--ui-text-highlighted);
}

.index-head {
    font-size: 15px;
    font-weight: 700;
    padding: 0 8px 10px;
    display: flex;
    align-items: baseline;
    gap: 8px;
}

.index-head.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    overflow: hidden;
}

.scope {
    font-size: 11px;
    font-weight: 400;
    color: var(--ui-text-muted);
}

.tabs {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.index button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--ui-text-toned);
    text-align: left;
    cursor: pointer;
}

.index button:hover {
    background: var(--ui-bg-accented);
}

.index button.on {
    background: var(--cd-selected);
    color: var(--ui-text-highlighted);
    font-weight: 600;
}

.note {
    margin: auto 8px 0;
    font-size: 11px;
    color: var(--ui-text-dimmed);
    line-height: 1.7;
}

.body {
    flex: 1;
    overflow: auto;
}

.inner {
    padding: 24px 32px 80px;
    position: relative;
}

.saved {
    position: sticky;
    top: 0;
    float: right;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--ui-color-success-500);
    opacity: 0;
    transition: opacity 0.2s;
}

.saved.show {
    opacity: 1;
}
</style>
