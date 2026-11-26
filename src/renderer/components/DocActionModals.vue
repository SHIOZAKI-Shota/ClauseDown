<script setup lang="ts">
import type { DocActions } from '~/composables/useDocActions'
import { useT } from '~/composables/useT'

const props = defineProps<{ actions: DocActions }>()
const t = useT()
const { pendingMove, pendingDelete, move, remove } = props.actions
</script>

<template>
	<ConfirmModal
		:open="!!pendingMove"
		:title="t.docs.move.title"
		:confirm-label="pendingMove?.folder ? t.docs.move.confirmTo(pendingMove.folder) : t.docs.move.confirmToRoot"
		@update:open="(v) => !v && (pendingMove = null)"
		@confirm="move"
	>
		<p class="note">{{ t.docs.move.body(pendingMove?.doc.title ?? '', pendingMove?.folder ?? '') }}</p>
		<p class="note muted">{{ t.docs.move.note }}</p>
	</ConfirmModal>
	<ConfirmModal
		:open="!!pendingDelete"
		:title="t.docs.remove.title"
		:confirm-label="t.docs.remove.confirm"
		color="error"
		@update:open="(v) => !v && (pendingDelete = null)"
		@confirm="remove"
	>
		<p class="note">{{ t.docs.remove.body(pendingDelete?.title ?? '') }}</p>
		<p class="note muted">{{ t.docs.remove.note }}</p>
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
