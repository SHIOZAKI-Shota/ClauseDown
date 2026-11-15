<script setup lang="ts">
import { COLOR_LABEL, DEFAULT_KINDS, EFFECTIVE_KIND, KIND_COLORS, type EventKind, type KindColor } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { useDebounced } from '~/composables/useDebounced'
import { sameJson, toPlain } from '~/utils/ipc'
import { useT } from '~/composables/useT'

const emit = defineEmits<{ saved: [] }>()
const app = useApp()
const t = useT()
const kinds = ref<EventKind[]>([])
const used = ref(new Set<string>())
let last: EventKind[] = []

async function load() {
    if (!app.repoDir) return
    const [k, events] = await Promise.all([window.api.getEventKinds(app.repoDir), window.api.listEvents(app.repoDir)])
    kinds.value = k
    last = structuredClone(k)
    used.value = new Set(events.map((e) => e.kind))
}
watch(() => [app.repoDir, app.scheduleKey], load, { immediate: true })

const save = useDebounced(async () => {
    const next = kinds.value.filter((k) => k.label.trim())
    if (sameJson(next, last)) return
    const ok = await app.runOk(() => window.api.saveEventKinds(app.repoDir!, toPlain(next)))
    if (ok) {
        last = structuredClone(next)
        emit('saved')
    } else await load()
}, 600)
watch(kinds, save, { deep: true })

// t.value を読んで言語の切り替えに追従する（COLOR_LABEL は言語に応じた値を返す）
const COLORS = computed(() => {
    void t.value
    return (Object.keys(KIND_COLORS) as KindColor[]).map((c) => ({ value: c, label: COLOR_LABEL[c] }))
})
const REMIND = computed(() => [-1, 0, 1, 3, 7, 14, 30, 60, 90].map((n) => ({ label: t.value.schedule.remindShort(n), value: n })))
function add() {
    const unused = COLORS.value.find((c) => !kinds.value.some((k) => k.color === c.value))?.value ?? 'slate'
    kinds.value.push({ id: `k-${Date.now().toString(36)}`, label: '', color: unused, task: true, remind: 7 })
}
function move(i: number, d: number) {
    const list = [...kinds.value]
    const [k] = list.splice(i, 1)
    list.splice(i + d, 0, k)
    kinds.value = list
}
const remove = (i: number) => kinds.value.splice(i, 1)
const resetDefaults = () => {
    const custom = kinds.value.filter((k) => !DEFAULT_KINDS.some((d) => d.id === k.id))
    kinds.value = [...DEFAULT_KINDS.map((k) => ({ ...k })), ...custom]
}
const removable = (k: EventKind) => k.id !== EFFECTIVE_KIND && !used.value.has(k.id)
const removeTip = (k: EventKind) =>
    k.id === EFFECTIVE_KIND
        ? t.value.schedule.kindsEditor.effectiveLocked
        : used.value.has(k.id)
          ? t.value.schedule.kindsEditor.usedLocked
          : t.value.schedule.remove
</script>

<template>
    <div class="kinds">
        <div class="head cd-muted">
            <span class="c-color">{{ t.schedule.kindsEditor.color }}</span>
            <span class="c-label">{{ t.schedule.kindsEditor.name }}</span>
            <span class="c-task">{{ t.schedule.kindsEditor.task }}</span>
            <span class="c-remind">{{ t.schedule.kindsEditor.remind }}</span>
        </div>
        <div v-for="(k, i) in kinds" :key="k.id" class="row">
            <UDropdownMenu
                :items="
                    COLORS.map((c) => ({
                        label: c.label,
                        onSelect: () => {
                            k.color = c.value
                        },
                        slot: 'color' as const,
                        hue: c.value,
                    }))
                "
            >
                <button class="swatch c-color" :style="{ '--k': KIND_COLORS[k.color] }" :aria-label="t.schedule.kindsEditor.colorOf(COLOR_LABEL[k.color])" />
                <template #color-leading="{ item }">
                    <span class="dot" :style="{ '--k': KIND_COLORS[(item as { hue: KindColor }).hue] }" />
                </template>
            </UDropdownMenu>
            <UInput v-model="k.label" size="sm" class="c-label" :placeholder="t.schedule.kindsEditor.namePlaceholder" :maxlength="20" />
            <USwitch v-model="k.task" class="c-task" :aria-label="t.schedule.kindsEditor.taskOf(k.label)" />
            <USelect v-model="k.remind" :items="REMIND" size="sm" class="c-remind" />
            <div class="ops">
                <UButton
                    icon="i-lucide-chevron-up"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    :aria-label="t.schedule.kindsEditor.up"
                    :disabled="i === 0"
                    @click="move(i, -1)"
                />
                <UButton
                    icon="i-lucide-chevron-down"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    :aria-label="t.schedule.kindsEditor.down"
                    :disabled="i === kinds.length - 1"
                    @click="move(i, 1)"
                />
                <UTooltip :text="removeTip(k)">
                    <UButton
                        icon="i-lucide-trash-2"
                        size="xs"
                        square
                        :color="removable(k) ? 'error' : 'neutral'"
                        variant="ghost"
                        :aria-label="t.schedule.remove"
                        :disabled="!removable(k)"
                        @click="remove(i)"
                    />
                </UTooltip>
            </div>
        </div>
        <div class="foot">
            <UButton :label="t.schedule.kindsEditor.add" icon="i-lucide-plus" size="sm" color="neutral" variant="outline" @click="add" />
            <UButton :label="t.schedule.kindsEditor.reset" icon="i-lucide-rotate-ccw" size="sm" color="neutral" variant="ghost" @click="resetDefaults" />
        </div>
        <p class="cd-muted note">
            {{ t.schedule.kindsEditor.note1 }}
            {{ t.schedule.kindsEditor.note2 }}
        </p>
    </div>
</template>

<style scoped>
.kinds {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
}

.head,
.row {
    display: grid;
    grid-template-columns: 32px minmax(120px, 220px) 80px 120px auto;
    align-items: center;
    gap: 10px;
}

.head {
    font-size: 11px;
}

.swatch {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--k);
    cursor: pointer;
    border: 2px solid var(--ui-bg);
    box-shadow: 0 0 0 1px var(--ui-border-accented);
}

.dot {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--k);
}

.ops {
    display: flex;
    gap: 2px;
}

.foot {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

.note {
    margin-top: 8px;
    font-size: 12px;
}
</style>
