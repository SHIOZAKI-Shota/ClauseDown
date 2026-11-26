<script setup lang="ts">
defineProps<{ label: string }>()
const emit = defineEmits<{ click: [] }>()
</script>

<template>
	<UButton :label="label" icon="i-lucide-arrow-left" size="sm" color="neutral" variant="ghost" @click="emit('click')" />
</template>
