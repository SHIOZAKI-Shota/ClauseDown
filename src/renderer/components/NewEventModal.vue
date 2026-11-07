<script setup lang="ts">
import type { DueEventInput, EventKind } from '@shared/schedule'
import { useApp } from '~/stores/app'
import { toPlain } from '~/utils/ipc'

const props = defineProps<{ docPath?: string; date?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const kinds = ref<EventKind[] | null>(null)
onMounted(async () => {
    kinds.value = await window.api.getEventKinds(app.repoDir!).catch(() => null)
    if (!kinds.value) emit('close')
})
async function save(input: DueEventInput) {
    const ok = await app.runOk(() => window.api.saveEvent(app.repoDir!, toPlain(input)), '期日を保存しました')
    if (!ok) return
    app.touchSchedule(app.repoDir!)
    emit('close')
}
</script>

<template>
    <DueEventModal v-if="kinds" :kinds="kinds"
        :initial="{ docPath: props.docPath ?? app.currentPath ?? '', date: props.date }" @close="emit('close')"
        @save="save" />
</template>
