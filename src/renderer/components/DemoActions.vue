<script setup lang="ts">
import { PROJECT } from '@shared/about'
import { useT } from '~/composables/useT'

const t = useT()
const confirmReset = ref(false)

async function reset() {
	const { resetDemo } = await import('~/demo/api')
	resetDemo()
	location.reload()
}
</script>

<template>
	<div class="demo-actions">
		<UTooltip :text="t.demo.badgeTooltip">
			<UBadge :label="t.demo.badge" color="primary" variant="subtle" size="sm" />
		</UTooltip>
		<UButton :label="t.demo.reset" icon="i-lucide-rotate-ccw" size="xs" color="neutral" variant="ghost" data-guide="reset" @click="confirmReset = true" />
		<UButton :label="t.demo.getApp" icon="i-lucide-download" size="xs" :to="`${PROJECT.repo}/releases/latest`" target="_blank" data-guide="get" />
		<ConfirmModal
			v-model:open="confirmReset"
			:title="t.demo.resetTitle"
			:description="t.demo.resetDesc"
			:confirm-label="t.demo.reset"
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
