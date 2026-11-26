<script setup lang="ts">
import { useTheme } from '~/composables/useTheme'

withDefaults(defineProps<{ variant?: 'outline' | 'ghost'; size?: 'xs' | 'sm' | 'md' }>(), { variant: 'outline', size: 'md' })
const { dark, toggle } = useTheme()
const t = useT()
</script>

<template>
	<UTooltip :text="dark ? t.shell.theme.toLight : t.shell.theme.toDark">
		<UButton
			:icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'"
			color="neutral"
			:variant="variant"
			:size="size"
			square
			:aria-label="dark ? t.shell.theme.toLight : t.shell.theme.toDark"
			@click="toggle"
		/>
	</UTooltip>
</template>
