<script setup lang="ts">
import { useApp } from '~/stores/app'
import { todayISO } from '~/utils/format'

const props = defineProps<{ oid: string; path: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const app = useApp()
const date = ref(todayISO())

async function save() {
    const ok = await app.runOk(() => window.api.addEffective(app.repoDir!, props.path, props.oid, date.value), `施行日 ${date.value} を付けました`)
    if (ok) emit('done')
}
</script>

<template>
    <UModal :open="true" title="施行日を付ける" description="選んだ版を、この日から施行する版として記録します。同じ日付がすでにあれば置き換えます。"
        @update:open="(v) => !v && emit('close')">
        <template #body>
            <UFormField label="施行日">
                <DateField v-model="date" />
            </UFormField>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="付ける" :loading="app.busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>
