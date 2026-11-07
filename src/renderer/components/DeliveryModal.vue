<script setup lang="ts">
import type { DeliveryItem, EffectiveVersion } from '@shared/api'
import { useApp } from '~/stores/app'
import { folderOf } from '~/utils/folders'

const props = defineProps<{ path: string; oid: string; baseOid?: string; effectiveDate?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const app = useApp()

const to = ref(folderOf(props.path))
const memo = ref('')
const items = ref<DeliveryItem[]>(['docPdf', 'docDocx', ...(props.baseOid ? (['cmpPdf', 'cmpDocx'] as DeliveryItem[]) : [])])
const NONE = 'none'
const base = ref(props.baseOid ?? NONE)
const publish = ref(!!app.forge)
const versions = ref<EffectiveVersion[]>([])

onMounted(async () => {
    versions.value = await window.api.listEffective(app.repoDir!, props.path)
})

const baseItems = computed(() => [
    { label: '（対照表を作らない）', value: NONE },
    ...versions.value.filter((v) => v.oid !== props.oid).map((v) => ({ label: `${v.date} 施行版`, value: v.oid })),
])
const itemOptions = computed(() => [
    { label: '条文本体（PDF）', value: 'docPdf' },
    { label: '条文本体（Word）', value: 'docDocx' },
    { label: '新旧対照表（PDF）', value: 'cmpPdf', disabled: base.value === NONE },
    { label: '新旧対照表（Word）', value: 'cmpDocx', disabled: base.value === NONE },
])
watch(base, (b) => {
    if (b === NONE) items.value = items.value.filter((x) => x !== 'cmpPdf' && x !== 'cmpDocx')
})

async function go() {
    const rec = await app.run(() =>
        window.api.deliver(app.repoDir!, {
            docPath: props.path,
            oid: props.oid,
            baseOid: base.value === NONE ? undefined : base.value,
            effectiveDate: props.effectiveDate,
            to: to.value.trim(),
            memo: memo.value.trim(),
            items: [...items.value],
            publishRelease: publish.value && !!app.forge,
        }),
    )
    if (!rec) return
    app.notify(rec.releaseError ? `納品一式を作りました（${app.forgeLabel} には載せられませんでした：${rec.releaseError}）` : `納品一式を作りました：${rec.folder}`, !!rec.releaseError)
    await window.api.openPath(rec.folder)
    emit('done')
}
</script>

<template>
    <UModal :open="true" :title="effectiveDate ? `${effectiveDate} 施行版を納品` : '現行版を納品'"
        description="保存先のフォルダに一式を作り、納品の記録を残します。" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField label="宛先" description="例：株式会社A 法務部 〇〇様">
                    <UInput v-model="to" class="cd-full" />
                </UFormField>
                <UFormField label="新旧対照表の改正前">
                    <USelect v-model="base" :items="baseItems" class="cd-full" />
                </UFormField>
                <UFormField label="納品するもの">
                    <UCheckboxGroup v-model="items" :items="itemOptions" />
                </UFormField>
                <UFormField label="メモ（任意）">
                    <UTextarea v-model="memo" :rows="2" class="cd-full" />
                </UFormField>
                <UCheckbox v-if="app.forge" v-model="publish" :label="`${app.forgeLabel} のリリースにも載せる`"
                    :description="`納品物を ${app.forgeLabel} に添付して残します`" />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="保存先を選んで作成" icon="i-lucide-package" :disabled="!items.length" :loading="app.busy"
                    @click="go" />
            </div>
        </template>
    </UModal>
</template>
