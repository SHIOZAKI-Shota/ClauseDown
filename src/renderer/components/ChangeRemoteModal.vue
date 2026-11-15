<script setup lang="ts">
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const t = useT()
const url = ref(app.repo?.url?.replace(/\.git$/, '') ?? '')
const sending = ref(false)
const changed = computed(() => {
    const v = url.value
        .trim()
        .replace(/\/+$/, '')
        .replace(/\.git$/, '')
    return !!v && v !== app.repo?.url?.replace(/\.git$/, '')
})

async function save() {
    sending.value = true
    try {
        if (await app.changeRemote(url.value)) open.value = false
    } finally {
        sending.value = false
    }
}
</script>

<template>
    <UModal v-model:open="open" :title="t.repo.changeRemote.title" :description="t.repo.changeRemote.description">
        <template #body>
            <div class="body">
                <UInput v-model="url" :placeholder="t.repo.changeRemote.placeholder" class="cd-full" autofocus @keydown.enter="changed && save()" />
                <p class="cd-muted">{{ t.repo.changeRemote.note }}</p>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.repo.cancel" color="neutral" variant="outline" @click="open = false" />
                <UButton :label="t.repo.changeRemote.submit" :loading="sending" :disabled="!changed" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.body {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
</style>
