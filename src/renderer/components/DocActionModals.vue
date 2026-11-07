<script setup lang="ts">
import type { DocActions } from '~/composables/useDocActions'

const props = defineProps<{ actions: DocActions }>()
const { pendingMove, pendingDelete, move, remove } = props.actions
</script>

<template>
    <ConfirmModal :open="!!pendingMove" title="文書を移動"
        :confirm-label="pendingMove?.folder ? `「${pendingMove.folder}」へ移動` : 'リポジトリの直下へ移動'"
        @update:open="(v) => !v && (pendingMove = null)" @confirm="move">
        <p class="note">「{{ pendingMove?.doc.title }}」を{{ pendingMove?.folder ? `「${pendingMove.folder}」` : 'リポジトリの直下'
        }}へ移動し、移動したことを版として記録します。</p>
        <p class="note muted">
            移動先のディレクトリの書式が使われます。改定履歴・新旧対照表・施行日は場所ごとに記録しているため、移動前の版は移動後の文書の履歴には出ません（元の場所の記録として残ります）。</p>
    </ConfirmModal>
    <ConfirmModal :open="!!pendingDelete" title="文書を削除" confirm-label="削除する" color="error"
        @update:open="(v) => !v && (pendingDelete = null)" @confirm="remove">
        <p class="note">「{{ pendingDelete?.title }}」を削除し、削除したことを版として記録します。</p>
        <p class="note muted">これまでの版は履歴に残ります。版を保存していない変更は失われます。</p>
    </ConfirmModal>
</template>

<style scoped>
.note {
    margin: 0 0 8px;
    font-size: 13px;
    line-height: 1.7;
}

.note.muted {
    font-size: 12px;
    color: var(--ui-text-muted);
}
</style>
