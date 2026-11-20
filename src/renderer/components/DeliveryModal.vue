<script setup lang="ts">
import type { DeliveryItem, EffectiveVersion } from '@shared/api'
import { useApp } from '~/stores/app'
import { folderOf } from '~/utils/folders'
import { useT } from '~/composables/useT'
import { usePdfSign } from '~/composables/usePdfSign'

const props = defineProps<{ path: string; oid: string; baseOid?: string; effectiveDate?: string }>()
const emit = defineEmits<{ close: []; done: [] }>()
const app = useApp()
const t = useT()

const to = ref(folderOf(props.path))
const memo = ref('')
const items = ref<DeliveryItem[]>(['docPdf', 'docDocx', ...(props.baseOid ? (['cmpPdf', 'cmpDocx'] as DeliveryItem[]) : [])])
const NONE = 'none'
const base = ref(props.baseOid ?? NONE)
const publish = ref(!!app.forge)
const pdfSign = usePdfSign()
const sign = ref(false)
const certId = ref<string | undefined>()
const certItems = computed(() => pdfSign.certs.value.map((c) => ({ value: c.id, label: c.label || t.value.signing.pdf.kinds[c.kind] })))
onMounted(async () => {
    const st = await pdfSign.load()
    sign.value = !!st && st.signing.pdf.certs.length > 0 && st.signing.pdf.onDeliver
    certId.value = pdfSign.defaultFor(app.repoDir ?? undefined)
})
const hasPdf = computed(() => items.value.some((i) => i === 'docPdf' || i === 'cmpPdf'))
const versions = ref<EffectiveVersion[]>([])

onMounted(async () => {
    versions.value = await window.api.listEffective(app.repoDir!, props.path)
})

const baseItems = computed(() => [
    { label: t.value.releases.delivery.noCompare, value: NONE },
    ...versions.value.filter((v) => v.oid !== props.oid).map((v) => ({ label: t.value.releases.effectiveVersion(v.date), value: v.oid })),
])
const itemOptions = computed(() => [
    { label: t.value.releases.item.docPdf, value: 'docPdf' },
    { label: t.value.releases.item.docDocx, value: 'docDocx' },
    { label: t.value.releases.item.cmpPdf, value: 'cmpPdf', disabled: base.value === NONE },
    { label: t.value.releases.item.cmpDocx, value: 'cmpDocx', disabled: base.value === NONE },
])
watch(base, (b) => {
    if (b === NONE) items.value = items.value.filter((x) => x !== 'cmpPdf' && x !== 'cmpDocx')
})

async function go() {
    const signing = hasPdf.value
        ? await pdfSign.plan('deliver', props.path, sign.value, { dir: app.repoDir ?? undefined, certId: certId.value })
        : { sign: false }
    if (!signing) return
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
            ...signing,
        }),
    )
    if (!rec) return
    app.notify(
        rec.releaseError ? t.value.releases.delivery.createdWithError(app.forgeLabel, rec.releaseError) : t.value.releases.delivery.created(rec.folder),
        !!rec.releaseError,
    )
    await window.api.openPath(rec.folder)
    emit('done')
}
</script>

<template>
    <UModal
        :open="true"
        :title="effectiveDate ? t.releases.delivery.titleVersion(effectiveDate) : t.releases.delivery.titleCurrent"
        :description="t.releases.delivery.description"
        @update:open="(v) => !v && emit('close')"
    >
        <template #body>
            <div class="cd-form">
                <UFormField :label="t.releases.delivery.to" :description="t.releases.delivery.toHelp">
                    <UInput v-model="to" class="cd-full" />
                </UFormField>
                <UFormField :label="t.releases.delivery.base">
                    <USelect v-model="base" :items="baseItems" class="cd-full" />
                </UFormField>
                <UFormField :label="t.releases.delivery.items">
                    <UCheckboxGroup v-model="items" :items="itemOptions" />
                </UFormField>
                <UFormField :help="pdfSign.ready.value ? undefined : t.signing.export.noCert">
                    <div class="sign-row">
                        <UCheckbox v-model="sign" :label="t.signing.export.sign" :disabled="!pdfSign.ready.value || !hasPdf" />
                        <USelect
                            v-if="certItems.length > 1"
                            v-model="certId"
                            :items="certItems"
                            :disabled="!sign || !hasPdf"
                            :aria-label="t.signing.pdf.pickLabel"
                            size="sm"
                            class="cert-select"
                        />
                    </div>
                </UFormField>
                <UFormField :label="t.releases.delivery.memo">
                    <UTextarea v-model="memo" :rows="2" class="cd-full" />
                </UFormField>
                <UCheckbox
                    v-if="app.forge"
                    v-model="publish"
                    :label="t.releases.delivery.publish(app.forgeLabel)"
                    :description="t.releases.delivery.publishHelp(app.forgeLabel)"
                />
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="t.releases.delivery.submit" icon="i-lucide-package" :disabled="!items.length" :loading="app.busy" @click="go" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.sign-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.cert-select {
    min-width: 220px;
}
</style>
