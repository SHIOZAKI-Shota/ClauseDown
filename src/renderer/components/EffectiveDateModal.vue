<script setup lang="ts">
import { useApp } from '~/stores/app'
import { todayISO } from '@shared/date'
import { useT } from '~/composables/useT'

const props = defineProps<{ oid: string; path: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const app = useApp()
const t = useT()
const date = ref(todayISO())

async function save() {
    const ok = await app.runOk(() => window.api.addEffective(app.repoDir!, props.path, props.oid, date.value), t.value.releases.effective.added(date.value))
    if (ok) emit('done')
}
</script>

<template>
    <UModal :open="true" :title="t.releases.setEffective" :description="t.releases.effective.description" @update:open="(v) => !v && emit('close')">
        <template #body>
            <UFormField :label="t.releases.effective.field">
                <DateField v-model="date" />
            </UFormField>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="t.releases.effective.submit" :loading="app.busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>
