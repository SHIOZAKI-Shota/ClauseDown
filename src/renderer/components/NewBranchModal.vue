<script setup lang="ts">
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ from?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()
const label = ref('')
const from = ref(props.from ?? app.currentBranch?.name ?? '')

const fromCurrent = computed(() => from.value === app.currentBranch?.name)
const items = computed(() =>
    app.branches.filter((b) => b.local || b.isMain).map((b) => ({ label: b.label + (b.current ? t.value.sync.newBranch.openNow : ''), value: b.name })),
)

async function create() {
    if (!label.value.trim()) return
    await app.flushEditor()
    const name = await app.run(() => window.api.createBranch(app.repoDir!, label.value.trim(), fromCurrent.value ? undefined : from.value))
    if (!name) return
    await app.afterBranchChange()
    app.notify(t.value.sync.newBranch.created(label.value.trim()))
    emit('close')
}
</script>

<template>
    <UModal :open="true" :title="t.sync.newBranch.title" :description="t.sync.newBranch.description" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField :label="t.sync.newBranch.name" :description="t.sync.newBranch.nameExample">
                    <UInput v-model="label" class="cd-full" autofocus @keydown.enter="create" />
                </UFormField>
                <UFormField :label="t.sync.newBranch.from">
                    <USelect v-model="from" :items="items" class="cd-full" />
                </UFormField>
                <UAlert
                    v-if="fromCurrent && app.hasUnsaved"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-info"
                    :title="t.sync.newBranch.carryOver(!!app.currentBranch?.isMain)"
                />
                <UAlert
                    v-if="!fromCurrent && app.hasUnsaved"
                    color="warning"
                    variant="subtle"
                    :title="t.sync.newBranch.blocked"
                    :description="t.sync.newBranch.blockedDesc"
                />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="t.sync.newBranch.submit" :disabled="!label.trim() || (!fromCurrent && app.hasUnsaved)" :loading="app.busy" @click="create" />
            </div>
        </template>
    </UModal>
</template>
