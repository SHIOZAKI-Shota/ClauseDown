<script setup lang="ts">
import { splitIssueRefs } from '@shared/issue-refs'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ text: string }>()
const app = useApp()
const t = useT()
const parts = computed(() => splitIssueRefs(props.text))
const open = (n: number) => app.openIssues({ n })
</script>

<template>
	<span class="cd-issue-text"
		><template v-for="(p, i) in parts" :key="i"
			><button v-if="typeof p === 'number'" type="button" class="ref" :title="t.issues.openIssue(p)" @click.stop="open(p)">#{{ p }}</button
			><template v-else>{{ p }}</template></template
		></span
	>
</template>

<style scoped>
.cd-issue-text {
	white-space: pre-wrap;
}

.ref {
	color: var(--ui-primary);
	cursor: pointer;
}

.ref:hover {
	text-decoration: underline;
}
</style>
