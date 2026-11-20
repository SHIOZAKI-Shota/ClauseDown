<script setup lang="ts">
import type { Issue } from '@shared/api'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ oid?: string; branch?: string; branchLabel?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()
const dir = app.repoDir!

const issues = ref<Issue[]>([])
const loading = ref(true)
const picked = ref<number[]>([])
const q = ref('')

onMounted(async () => {
    issues.value = (await app.run(() => window.api.listIssues(dir))) ?? []
    if (props.branch) picked.value = (await app.run(() => window.api.branchIssues(dir, props.branch!))) ?? []
    loading.value = false
})

const shown = computed(() => {
    const w = q.value.trim().toLowerCase()
    return issues.value.filter(
        (i) => (props.branch ? i.state === 'open' || picked.value.includes(i.n) : true) && (!w || `#${i.n} ${i.title}`.toLowerCase().includes(w)),
    )
})

function toggle(n: number) {
    if (props.oid) picked.value = picked.value[0] === n ? [] : [n]
    else picked.value = picked.value.includes(n) ? picked.value.filter((x) => x !== n) : [...picked.value, n]
}

async function save() {
    if (props.oid && picked.value[0]) {
        const n = picked.value[0]
        if (await app.runOk(() => window.api.linkIssue(dir, n, props.oid!), t.value.issues.linkModal.linked(n))) emit('close')
    } else if (props.branch) {
        if (await app.runOk(() => window.api.setBranchIssues(dir, props.branch!, picked.value), t.value.issues.linkModal.branchSaved)) emit('close')
    }
}
</script>

<template>
    <UModal
        :open="true"
        :title="oid ? t.issues.linkModal.titleVersion : t.issues.linkModal.titleBranch(branchLabel ?? '')"
        :description="oid ? t.issues.linkModal.descVersion(oid.slice(0, 7)) : t.issues.linkModal.descBranch"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <UInput v-model="q" icon="i-lucide-search" :placeholder="t.issues.linkModal.search" size="sm" class="w-full" />
            <p v-if="loading" class="cd-muted pad">{{ t.issues.loading }}</p>
            <p v-else-if="!shown.length" class="cd-muted pad">{{ t.issues.linkModal.empty }}</p>
            <div class="list">
                <button v-for="i in shown" :key="i.n" type="button" class="row" :class="{ on: picked.includes(i.n) }" @click="toggle(i.n)">
                    <UIcon
                        :name="picked.includes(i.n) ? (oid ? 'i-lucide-circle-dot' : 'i-lucide-square-check') : oid ? 'i-lucide-circle' : 'i-lucide-square'"
                    />
                    <span class="num">#{{ i.n }}</span>
                    <span class="ttl">{{ i.title }}</span>
                    <UBadge v-if="i.state === 'closed'" :label="t.issues.closedState" size="sm" color="neutral" variant="subtle" />
                </button>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="oid ? t.issues.link : t.issues.linkModal.record" :disabled="!!oid && !picked.length" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.pad {
    padding: 12px 4px;
}

.list {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
    margin-top: 8px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
}

.row:hover {
    background: var(--ui-bg-elevated);
}

.row.on {
    background: var(--cd-selected);
}

.num {
    color: var(--ui-text-muted);
}

.ttl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
