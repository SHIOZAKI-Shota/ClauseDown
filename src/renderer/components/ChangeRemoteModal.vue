<script setup lang="ts">
import { useApp } from '~/stores/app'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const url = ref(app.repo?.url?.replace(/\.git$/, '') ?? '')
const sending = ref(false)
const changed = computed(() => {
    const v = url.value.trim().replace(/\/+$/, '').replace(/\.git$/, '')
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
    <UModal v-model:open="open" title="リモートを変更" description="GitHub・GitLab でリポジトリの名前や持ち主を変えたとき、新しい URL を入れます。">
        <template #body>
            <div class="body">
                <UInput v-model="url" placeholder="https://github.com/組織名/リポジトリ名" class="cd-full" autofocus
                    @keydown.enter="changed && save()" />
                <p class="cd-muted">
                    新しいリモートが空なら、すべての版を送信します。中身がある場合は、このリポジトリと同じ履歴を持っているときだけ変更します。別のリポジトリに誤ってつながないためです。
                </p>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="open = false" />
                <UButton label="変更する" :loading="sending" :disabled="!changed" @click="save" />
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
