<script setup lang="ts">
import { splitIssueRefs } from '@shared/issue-refs'
import { useApp } from '~/stores/app'

const props = defineProps<{ text: string }>()
const app = useApp()
const parts = computed(() => splitIssueRefs(props.text))
</script>

<template>
    <span class="cd-issue-text"><template v-for="(p, i) in parts" :key="i"><button v-if="typeof p === 'number'"
                type="button" class="ref" :title="`課題 #${p} を開く`" @click.stop="app.openIssues({ n: p })">#{{ p
                }}</button><template v-else>{{ p }}</template></template></span>
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
