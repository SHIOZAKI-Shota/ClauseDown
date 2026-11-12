<script setup lang="ts">
import { useApp } from '~/stores/app'
import { allFolders } from '~/utils/folders'

const props = defineProps<{ folder?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const client = ref(props.folder ?? '')
const title = ref('')
const folderDefault = () => app.styleFor(`${clean(client.value)}/_.md`).newDocPreset
const preset = ref<'law' | 'contract'>(folderDefault())
function guess() {
    const t = title.value
    if (/契約|覚書|合意書|念書/.test(t)) preset.value = 'contract'
    else if (/法律|法案|条例|規則|規程|規定|規約|要領|要綱|定款/.test(t)) preset.value = 'law'
    else preset.value = folderDefault()
}
watch([title, client], guess)

const folders = computed(() => allFolders(app.docs))
const SUGGEST = ['〇〇に関する法律案', '〇〇条例案', '業務委託契約書', '秘密保持契約書', '利用規約', '就業規則', '定款']

function clean(s: string) {
    return s
        .trim()
        .replace(/[\\:*?"<>|]/g, '_')
        .split('/')
        .map((p) => p.trim())
        .filter((p) => p && p !== '.' && p !== '..')
        .join('/')
}
const isNewClient = computed(() => !!client.value.trim() && !folders.value.includes(clean(client.value)))
const path = computed(() => {
    const name = clean(title.value).replace(/\//g, '_')
    if (!name) return ''
    const dir = clean(client.value)
    return `${dir ? dir + '/' : ''}${name}.md`
})
const exists = computed(() => app.docs.some((d) => d.path === path.value))

async function create() {
    if (!path.value || exists.value) return
    const p = path.value
    const ok = await app.runOk(() => window.api.createDoc(app.repoDir!, p, title.value.trim(), preset.value))
    if (!ok) return
    await app.refreshDocs()
    app.openDoc(p)
    emit('close')
}
</script>

<template>
    <UModal :open="true" title="新しい文書" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField
                    label="ディレクトリ"
                    :hint="isNewClient ? `ディレクトリ「${clean(client)}」を作ります` : ''"
                    description="文書を入れるディレクトリです。空欄ならディレクトリに入れません"
                >
                    <UInputMenu v-model="client" :items="folders" create-item placeholder="例：契約書" class="cd-full" @create="(v: string) => (client = v)" />
                </UFormField>
                <UFormField label="文書の名前">
                    <UInput v-model="title" class="cd-full" autofocus @keydown.enter="create" />
                </UFormField>
                <div class="chips">
                    <UButton v-for="s in SUGGEST" :key="s" :label="s" size="xs" color="neutral" variant="outline" @click="title = s" />
                </div>
                <UFormField label="書式">
                    <SegmentSwitch
                        v-model="preset"
                        aria-label="書式"
                        :items="[
                            { value: 'law', label: '法令式', description: '章・（見出し）・第1条・号は 一、二。法律案・条例・規約・規程などに' },
                            { value: 'contract', label: '契約書式', description: '第1条（見出し）・号は（1）。契約書・覚書・合意書などに' },
                        ]"
                    />
                </UFormField>
                <p v-if="path" class="cd-muted">保存先：{{ path }}</p>
                <UAlert v-if="exists" color="error" variant="subtle" title="同じ名前の文書がすでにあります" />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="作成" :disabled="!path || exists" :loading="app.busy" @click="create" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
</style>
