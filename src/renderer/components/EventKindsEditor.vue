<script setup lang="ts">
import { COLOR_LABEL, DEFAULT_KINDS, EFFECTIVE_KIND, KIND_COLORS, type EventKind, type KindColor } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { useDebounced } from '~/composables/useDebounced'
import { sameJson, toPlain } from '~/utils/ipc'

const emit = defineEmits<{ saved: [] }>()
const app = useApp()
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

const COLORS = (Object.keys(KIND_COLORS) as KindColor[]).map((c) => ({ value: c, label: COLOR_LABEL[c] }))
const REMIND = [{ label: '知らせない', value: -1 }, { label: '当日', value: 0 }, ...[1, 3, 7, 14, 30, 60, 90].map((n) => ({ label: `${n} 日前`, value: n }))]
function add() {
    const unused = COLORS.find((c) => !kinds.value.some((k) => k.color === c.value))?.value ?? 'slate'
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
    k.id === EFFECTIVE_KIND ? '施行は版の施行日にも使うので消せません' : used.value.has(k.id) ? 'この種類の期日があるので消せません' : '消す'
</script>

<template>
    <div class="kinds">
        <div class="head cd-muted">
            <span class="c-color">色</span>
            <span class="c-label">名前</span>
            <span class="c-task">済みにする</span>
            <span class="c-remind">知らせる</span>
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
                <button class="swatch c-color" :style="{ '--k': KIND_COLORS[k.color] }" :aria-label="`色：${COLOR_LABEL[k.color]}`" />
                <template #color-leading="{ item }">
                    <span class="dot" :style="{ '--k': KIND_COLORS[(item as { hue: KindColor }).hue] }" />
                </template>
            </UDropdownMenu>
            <UInput v-model="k.label" size="sm" class="c-label" placeholder="種類の名前" :maxlength="20" />
            <USwitch v-model="k.task" class="c-task" :aria-label="`${k.label}を「済みにする」種類にする`" />
            <USelect v-model="k.remind" :items="REMIND" size="sm" class="c-remind" />
            <div class="ops">
                <UButton
                    icon="i-lucide-chevron-up"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    aria-label="上へ"
                    :disabled="i === 0"
                    @click="move(i, -1)"
                />
                <UButton
                    icon="i-lucide-chevron-down"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    aria-label="下へ"
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
                        aria-label="消す"
                        :disabled="!removable(k)"
                        @click="remove(i)"
                    />
                </UTooltip>
            </div>
        </div>
        <div class="foot">
            <UButton label="種類を足す" icon="i-lucide-plus" size="sm" color="neutral" variant="outline" @click="add" />
            <UButton label="既定の種類を戻す" icon="i-lucide-rotate-ccw" size="sm" color="neutral" variant="ghost" @click="resetDefaults" />
        </div>
        <p class="cd-muted note">
            「済みにする」をオンにした種類（提出・届出など）は、済みにするまで残り、期限を過ぎると「期限切れ」と表示します。
            知らせる日は期日ごとに変えられます。通知のオン・オフは、アプリの設定の「期日・有効期間」にあります。
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
