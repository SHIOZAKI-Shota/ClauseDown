<script setup lang="ts">
import { PROJECT } from '@shared/about'

const confirmReset = ref(false)

async function reset() {
    const { resetDemo } = await import('~/demo/api')
    resetDemo()
    location.reload()
}
</script>

<template>
    <div class="demo-actions">
        <UTooltip text="書いた内容と保存した版は、このブラウザーにだけ残ります">
            <UBadge label="デモ" color="primary" variant="subtle" size="sm" />
        </UTooltip>
        <UButton label="見本に戻す" icon="i-lucide-rotate-ccw" size="xs" color="neutral" variant="ghost" @click="confirmReset = true" />
        <UButton label="アプリを入手" icon="i-lucide-download" size="xs" :to="`${PROJECT.repo}/releases/latest`" target="_blank" />
        <ConfirmModal
            v-model:open="confirmReset"
            title="見本に戻しますか？"
            description="書いた内容と保存した版を消して、最初の見本に戻します。"
            confirm-label="見本に戻す"
            color="error"
            @confirm="reset"
        />
    </div>
</template>

<style scoped>
.demo-actions {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 6px;
}
</style>
