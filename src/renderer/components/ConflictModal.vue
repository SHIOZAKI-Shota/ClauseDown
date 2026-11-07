<script setup lang="ts">
import type { ConflictChoice, SyncState } from '@shared/api'
import { useApp } from '~/stores/app'
import { toPlain } from '~/utils/ipc'

const props = defineProps<{ state: Extract<SyncState, { state: 'diverged' }> }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const choices = ref<Record<string, ConflictChoice>>({})
const unresolved = computed(() => props.state.conflicts.filter((c) => !choices.value[c.path]).length)
const auto = computed(() => props.state.autoMerged ?? [])
const summary = computed(
    () => `同じ箇所の重なり ${props.state.conflicts.length} 件${auto.value.length ? `・自動で統合 ${auto.value.length} 件` : ''}`,
)

async function apply() {
    await app.flushEditor()
    const s = await app.run(() => window.api.resolveConflicts(app.repoDir!, props.state.theirs, toPlain(choices.value)))
    if (!s) return
    app.syncState = s
    if (s.state === 'error') app.notify(s.message, true)
    else app.notify('リモートの変更を取り込みました')
    await app.afterBranchChange()
    emit('close')
}
</script>

<template>
    <WorkspaceModal v-if="state.conflicts.length" title="リモートの変更を取り込む" :summary="summary" @close="emit('close')">
        <ConflictResolver v-model="choices" :conflicts="state.conflicts" ours-label="自分の版" theirs-label="相手の版" />
        <template #footer>
            <span class="cd-grow" />
            <UButton label="あとで" size="sm" color="neutral" variant="outline" @click="emit('close')" />
            <UButton label="取り込む" size="sm" :loading="app.busy" :disabled="unresolved > 0" @click="apply" />
        </template>
    </WorkspaceModal>

    <UModal v-else :open="true" title="リモートの変更を取り込む" @update:open="(v) => !v && emit('close')">
        <template #body>
            <p class="text">あなたと他の人が別々に変更しましたが、同じ箇所は重なっていません。両方の変更をまとめて取り込みます。</p>
            <ul v-if="auto.length" class="files">
                <li v-for="f in auto" :key="f">{{ f }}</li>
            </ul>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="あとで" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="取り込む" :loading="app.busy" @click="apply" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.text {
    margin: 0 0 8px;
    font-size: 13px;
}

.files {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    list-style: disc;
}
</style>
