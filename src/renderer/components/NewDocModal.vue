<script setup lang="ts">
import { useApp } from '~/stores/app'
import { allFolders } from '~/utils/folders'
import { useT } from '~/composables/useT'

const props = defineProps<{ folder?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()
const client = ref(props.folder ?? '')
const title = ref('')
const folderDefault = () => app.styleFor(`${clean(client.value)}/_.md`).newDocPreset
const preset = ref<'law' | 'contract'>(folderDefault())
function guess() {
    const s = title.value
    if (/契約|覚書|合意書|念書|agreement|contract|memorandum/i.test(s)) preset.value = 'contract'
    else if (/法律|法案|条例|規則|規程|規定|規約|要領|要綱|定款|\bact\b|bill|ordinance|rules|regulations?|terms|articles of/i.test(s)) preset.value = 'law'
    else preset.value = folderDefault()
}
watch([title, client], guess)

const folders = computed(() => allFolders(app.docs))
const suggest = computed(() => t.value.docs.create.suggest.split('\n'))

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
    <UModal :open="true" :title="t.docs.create.title" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField :label="t.docs.directory" :hint="isNewClient ? t.docs.create.newFolder(clean(client)) : ''" :description="t.docs.create.folderDesc">
                    <UInputMenu
                        v-model="client"
                        :items="folders"
                        create-item
                        :placeholder="t.docs.create.folderPlaceholder"
                        class="cd-full"
                        @create="(v: string) => (client = v)"
                    />
                </UFormField>
                <UFormField :label="t.docs.create.name">
                    <UInput v-model="title" class="cd-full" autofocus @keydown.enter="create" />
                </UFormField>
                <div class="chips">
                    <UButton v-for="s in suggest" :key="s" :label="s" size="xs" color="neutral" variant="outline" @click="title = s" />
                </div>
                <UFormField :label="t.docs.create.format">
                    <SegmentSwitch
                        v-model="preset"
                        :aria-label="t.docs.create.format"
                        :items="[
                            { value: 'law', label: t.docs.create.law, description: t.docs.create.lawDesc },
                            { value: 'contract', label: t.docs.create.contract, description: t.docs.create.contractDesc },
                        ]"
                    />
                </UFormField>
                <p v-if="path" class="cd-muted">{{ t.docs.create.savedAs(path) }}</p>
                <UAlert v-if="exists" color="error" variant="subtle" :title="t.docs.create.exists" />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.docs.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="t.docs.create.submit" :disabled="!path || exists" :loading="app.busy" @click="create" />
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
