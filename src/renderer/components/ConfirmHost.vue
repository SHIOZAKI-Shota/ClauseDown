<script setup lang="ts">
import { useConfirmHost } from '~/composables/useConfirm'

const { current, open, settle } = useConfirmHost()
</script>

<template>
    <ConfirmModal
        v-if="current"
        v-model:open="open"
        :title="current.title"
        :description="current.description"
        :confirm-label="current.confirmLabel"
        :cancel-label="current.cancelLabel"
        :color="current.color"
        @confirm="settle(true)"
    />
</template>
