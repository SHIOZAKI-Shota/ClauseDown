<script setup lang="ts">
import { useApp } from '~/stores/app'

const props = defineProps<{ from?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const label = ref('')
const from = ref(props.from ?? app.currentBranch?.name ?? '')

const fromCurrent = computed(() => from.value === app.currentBranch?.name)
const items = computed(() =>
    app.branches.filter((b) => b.local || b.isMain).map((b) => ({ label: b.label + (b.current ? '（今開いている案）' : ''), value: b.name })),
)

async function create() {
    if (!label.value.trim()) return
    await app.flushEditor()
    const name = await app.run(() => window.api.createBranch(app.repoDir!, label.value.trim(), fromCurrent.value ? undefined : from.value))
    if (!name) return
    await app.afterBranchChange()
    app.notify(`改定案「${label.value.trim()}」を作りました。ここでの変更は現行版に影響しません`)
    emit('close')
}
</script>

<template>
    <UModal
        :open="true"
        title="新しい改定案"
        description="現行版に影響を与えずに書き直すための作業用の写しです。確認が済んだら「現行版に反映」します。"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <div class="cd-form">
                <UFormField label="改定案の名前" description="例：2026年4月改定、第3条の見直し">
                    <UInput v-model="label" class="cd-full" autofocus @keydown.enter="create" />
                </UFormField>
                <UFormField label="元にする版">
                    <USelect v-model="from" :items="items" class="cd-full" />
                </UFormField>
                <UAlert
                    v-if="fromCurrent && app.hasUnsaved"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    :title="`保存していない変更は、新しい改定案に引き継がれます。${app.currentBranch?.isMain ? '現行版は変わりません。' : ''}`"
                />
                <UAlert
                    v-if="!fromCurrent && app.hasUnsaved"
                    color="warning"
                    variant="subtle"
                    title="保存していない変更があるため、別の版からは作れません"
                    description="先に「版を保存」するか、「今開いている案」を選んでください。"
                />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="作成して切り替え" :disabled="!label.trim() || (!fromCurrent && app.hasUnsaved)" :loading="app.busy" @click="create" />
            </div>
        </template>
    </UModal>
</template>
