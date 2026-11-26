<script setup lang="ts">
import { useApp } from '~/stores/app'

const app = useApp()
</script>

<template>
	<div class="about-view">
		<BackButton :label="app.returnLabel" class="back" @click="app.goBack()" />
		<AboutSection />
	</div>
</template>

<style scoped>
.about-view {
	padding: 24px 32px 80px;
}

.back {
	margin: -8px 0 8px -10px;
}
</style>
