<script setup lang="ts">
import { GITHUB_APP } from '@shared/about'
import { isRepoUrlFor, newRepoUrl } from '@shared/forge'
import { useApp } from '~/stores/app'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const url = ref('')
const sending = ref(false)

const baseSel = ref(app.accounts.find((a) => a.login)?.base ?? app.accounts[0]?.base ?? '')
const account = computed(() => app.accounts.find((a) => a.base === baseSel.value))
const serverItems = computed(() => app.accounts.map((a) => ({ label: a.login ? `${a.label}（${a.login}）` : a.label, value: a.base })))
const github = computed(() => account.value?.kind === 'github')
const loggedIn = computed(() => !!account.value?.login)
const createUrl = computed(() => (account.value ? newRepoUrl(account.value, app.repo?.name ?? '') : ''))
const urlOk = computed(() => !!account.value && isRepoUrlFor(url.value.trim(), account.value))
const example = computed(() => `${account.value?.base ?? 'https://github.com'}/組織名/リポジトリ名`)

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
    <UModal
        v-model:open="open"
        title="リモートを追加"
        description="ローカル だけで管理していたリポジトリを GitHub・GitLab に送信して、ほかの人や別の PC と共有できるようにします。"
    >
        <template #body>
            <ol class="steps">
                <li>
                    <strong>リモートを置く場所を選ぶ</strong>
                    <p class="cd-muted">社内の GitLab は、設定の「GitHub/GitLab」で追加すると選べます。</p>
                    <USelect v-model="baseSel" :items="serverItems" class="cd-w-input" />
                </li>
                <li :class="{ done: loggedIn }">
                    <strong>{{ account?.label }} にログインする</strong>
                    <p v-if="loggedIn" class="cd-muted">{{ account?.login }} としてログインしています。</p>
                    <template v-else>
                        <p class="cd-muted">設定の「GitHub/GitLab」でログインしてください。</p>
                        <UButton label="ログインの設定を開く" :icon="github ? 'i-lucide-github' : 'i-lucide-gitlab'" size="sm" @click="goLogin" />
                    </template>
                </li>
                <li>
                    <strong>空のリポジトリを作る</strong>
                    <p v-if="github" class="cd-muted"><b>Private</b> を選び、「Add README」「.gitignore」「license」は<b>付けずに</b>作ってください。</p>
                    <p v-else class="cd-muted">
                        「空のプロジェクトを作成」で、表示レベルは <b>非公開（Private）</b>、「README を追加」の<b>チェックを外して</b>作ってください。
                    </p>
                    <UButton
                        :label="github ? 'GitHub で作る' : 'GitLab で作る'"
                        icon="i-lucide-external-link"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="ext(createUrl)"
                    />
                </li>
                <li v-if="github">
                    <strong>そのリポジトリに ClauseDown の App を入れる</strong>
                    <p class="cd-muted">インストール済みなら、開いた画面で今作ったリポジトリを追加して保存します。</p>
                    <UButton
                        label="App の設定を開く"
                        icon="i-lucide-external-link"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        @click="ext(GITHUB_APP.installUrl)"
                    />
                </li>
                <li>
                    <strong>作ったリポジトリの URL を貼り付ける</strong>
                    <UInput v-model="url" :placeholder="example" class="cd-full" />
                    <p v-if="url && !urlOk" class="warn">{{ example }} の形で入力してください。</p>
                </li>
            </ol>
            <p class="cd-muted note">現行版・すべての改定案・承認や納品の記録・施行日をまとめて送ります。ローカル のフォルダはそのまま使い続けます。</p>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="open = false" />
                <UButton label="リモートに送信する" icon="i-lucide-cloud-upload" :loading="sending" :disabled="!loggedIn || !urlOk" @click="publish" />
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
