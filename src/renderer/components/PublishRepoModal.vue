<script setup lang="ts">
import { GITHUB_APP } from '@shared/about'
import { isRepoUrlFor, newRepoUrl } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const t = useT()
const url = ref('')
const sending = ref(false)

const baseSel = ref(app.accounts.find((a) => a.login)?.base ?? app.accounts[0]?.base ?? '')
const account = computed(() => app.accounts.find((a) => a.base === baseSel.value))
const serverItems = computed(() => app.accounts.map((a) => ({ label: a.login ? t.value.repo.publish.server(a.label, a.login) : a.label, value: a.base })))
const github = computed(() => account.value?.kind === 'github')
const loggedIn = computed(() => !!account.value?.login)
const createUrl = computed(() => (account.value ? newRepoUrl(account.value, app.repo?.name ?? '') : ''))
const urlOk = computed(() => !!account.value && isRepoUrlFor(url.value.trim(), account.value))
const example = computed(() => t.value.repo.publish.example(account.value?.base ?? 'https://github.com'))

const createHelp = computed(() => (github.value ? t.value.repo.publish.githubCreate : t.value.repo.publish.gitlabCreate))

const ext = (u: string) => window.api.openExternal(u)
function goLogin() {
    open.value = false
    app.openSettings('setup', 'remote')
}
async function publish() {
    sending.value = true
    try {
        if (await app.publishRepo(url.value)) open.value = false
    } finally {
        sending.value = false
    }
}
</script>

<template>
    <UModal v-model:open="open" :title="t.repo.publish.title" :description="t.repo.publish.description">
        <template #body>
            <ol class="steps">
                <li>
                    <strong>{{ t.repo.publish.chooseHost }}</strong>
                    <p class="cd-muted">{{ t.repo.publish.chooseHostNote }}</p>
                    <USelect v-model="baseSel" :items="serverItems" class="cd-w-input" />
                </li>
                <li :class="{ done: loggedIn }">
                    <strong>{{ t.repo.publish.login(account?.label ?? '') }}</strong>
                    <p v-if="loggedIn" class="cd-muted">{{ t.repo.publish.loggedInAs(account?.login ?? '') }}</p>
                    <template v-else>
                        <p class="cd-muted">{{ t.repo.publish.loginNote }}</p>
                        <UButton :label="t.repo.publish.openLogin" :icon="github ? 'i-lucide-github' : 'i-lucide-gitlab'" size="sm" @click="goLogin" />
                    </template>
                </li>
                <li>
                    <strong>{{ t.repo.publish.createEmpty }}</strong>
                    <p class="cd-muted">{{ createHelp.a }}<b>{{ createHelp.b1 }}</b>{{ createHelp.c }}<b>{{ createHelp.b2 }}</b>{{ createHelp.d }}</p>
                    <UButton
                        :label="t.repo.publish.createOn(github ? 'GitHub' : 'GitLab')"
                        icon="i-lucide-external-link"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="ext(createUrl)"
                    />
                </li>
                <li v-if="github">
                    <strong>{{ t.repo.publish.installApp }}</strong>
                    <p class="cd-muted">{{ t.repo.publish.installAppNote }}</p>
                    <UButton
                        :label="t.repo.publish.openApp"
                        icon="i-lucide-external-link"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="ext(GITHUB_APP.installUrl)"
                    />
                </li>
                <li>
                    <strong>{{ t.repo.publish.pasteUrl }}</strong>
                    <UInput v-model="url" :placeholder="example" class="cd-full" />
                    <p v-if="url && !urlOk" class="warn">{{ t.repo.publish.urlFormat(example) }}</p>
                </li>
            </ol>
            <p class="cd-muted note">{{ t.repo.publish.note }}</p>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.repo.cancel" color="neutral" variant="outline" @click="open = false" />
                <UButton :label="t.repo.publish.submit" icon="i-lucide-cloud-upload" :loading="sending" :disabled="!loggedIn || !urlOk" @click="publish" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.steps {
    margin: 0;
    padding-left: 22px;
    list-style: decimal;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
}

.steps li::marker {
    font-weight: 700;
    color: var(--ui-color-primary-500);
}

.steps li.done::marker {
    color: var(--ui-color-success-500);
}

.steps p {
    margin: 2px 0 6px;
    font-size: 12px;
    line-height: 1.7;
}

.warn {
    color: var(--ui-color-warning-600);
}

.note {
    margin: 16px 0 0;
    font-size: 12px;
    line-height: 1.7;
}
</style>
