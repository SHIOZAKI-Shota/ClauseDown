<script setup lang="ts">
import type { RepoEntry, RepoState } from '@shared/api'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ repo: RepoEntry; state: RepoState; compact?: boolean }>()
const app = useApp()
const t = useT()
const checking = ref(false)

const title = computed(() =>
    props.state === 'missing' ? t.value.repo.missing.titleMissing(props.repo.name) : t.value.repo.missing.titleNotRepo(props.repo.name),
)
const reasons = computed(() => (props.state === 'missing' ? t.value.repo.missing.reasonsMissing : t.value.repo.missing.reasonsNotRepo).split('\n'))

async function retry() {
    checking.value = true
    try {
        await app.checkRepos()
        if (app.repoStates[props.repo.dir] === 'ok') {
            if (props.repo.dir === app.repoDir) await app.refreshDocs()
            app.notify(t.value.repo.missing.found)
        } else app.notify(t.value.repo.missing.stillMissing, true)
    } finally {
        checking.value = false
    }
}
</script>

<template>
    <div class="missing" :class="{ compact }">
        <UIcon name="i-lucide-folder-x" class="big" />
        <h2>{{ title }}</h2>
        <p class="path">{{ repo.dir }}</p>
        <div class="why">
            <p>{{ t.repo.missing.reasons }}</p>
            <ul>
                <li v-for="r in reasons" :key="r">{{ r }}</li>
            </ul>
        </div>
        <div class="actions">
            <UButton :label="t.repo.missing.relocate" icon="i-lucide-folder-search" @click="app.relocateRepo(repo.dir)" />
            <UButton :label="t.repo.missing.retry" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="checking" @click="retry" />
            <UButton :label="t.repo.removeFromList" color="error" variant="ghost" @click="app.forgetRepo(repo.dir)" />
        </div>
        <p v-if="repo.url" class="cd-muted hint">{{ t.repo.missing.hint(repo.url) }}</p>
    </div>
</template>

<style scoped>
.missing {
    max-width: 640px;
    margin: 48px auto;
    padding: 0 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
}

.missing.compact {
    margin: 0;
    padding: 0;
    max-width: none;
}

.big {
    width: 40px;
    height: 40px;
    color: var(--ui-color-warning-500);
}

h2 {
    font-size: 18px;
    font-weight: 700;
    margin: 0;
}

.path {
    font-family: var(--cd-ed-font);
    font-size: 12px;
    color: var(--ui-text-muted);
    margin: 0;
    word-break: break-all;
}

.why {
    font-size: 13px;
    color: var(--ui-text-toned);
}

.why p {
    margin: 4px 0;
    font-weight: 600;
}

.why ul {
    margin: 0;
    padding-left: 20px;
    line-height: 1.8;
}

.actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
}

.hint {
    margin-top: 4px;
}
</style>
