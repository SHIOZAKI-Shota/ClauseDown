<script setup lang="ts">
import { useTheme } from '~/composables/useTheme'

withDefaults(defineProps<{ variant?: 'outline' | 'ghost'; size?: 'xs' | 'sm' | 'md' }>(), { variant: 'outline', size: 'md' })
const { dark, toggle } = useTheme()
</script>

<template>
    <UTooltip :text="dark ? 'ライトモードにする' : 'ダークモードにする'">
        <UButton :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'" color="neutral" :variant="variant" :size="size" square
            :aria-label="dark ? 'ライトモードにする' : 'ダークモードにする'" @click="toggle" />
    </UTooltip>
</template>
