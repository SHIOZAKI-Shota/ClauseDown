<script setup lang="ts">
import { todayISO } from '~/utils/format'
import { useApp } from '~/stores/app'

export interface SaveRequest {
    message: string
    effectiveDate?: string
    draftName?: string
}

const props = defineProps<{ busy: boolean; branchLabel: string; onMain: boolean; hasHistory: boolean }>()
const emit = defineEmits<{ close: []; save: [SaveRequest] }>()
const message = ref('')
const withDate = ref(false)
const date = ref(todayISO())
const target = ref<'here' | 'draft'>('here')
const draftName = ref('')

const app = useApp()
const aiReady = ref(false)
const drafting = ref(false)
onMounted(async () => {
    aiReady.value = (await window.api.aiStatus().catch(() => null))?.ready ?? false
})
async function draftMessage() {
    if (!app.repoDir) return
    await app.flushEditor()
    drafting.value = true
    const text = await app.run(() => window.api.suggestVersionMessage(app.repoDir!))
    drafting.value = false
    if (text) message.value = text
}

const canSave = computed(
    () => !!message.value.trim() && !props.busy && (target.value === 'here' || !!draftName.value.trim()),
)

function save() {
    if (!canSave.value) return
    emit('save', {
        message: message.value.trim(),
        effectiveDate: withDate.value && target.value === 'here' ? date.value : undefined,
        draftName: target.value === 'draft' ? draftName.value.trim() : undefined,
    })
}
</script>

<template>
    <UModal :open="true" title="版を保存"
        description="今の内容を一つの版として記録します（リモートがあれば、設定に従って送信します）。あとから改定履歴で見返したり、新旧対照表を作ったりできます。"
        @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField v-if="onMain && hasHistory" label="保存先">
                    <SegmentSwitch v-model="target" aria-label="保存先" :items="[
                        { value: 'here', label: '現行版に保存', icon: 'i-lucide-badge-check', description: 'すぐに正式な版になります。誤字の修正など、確認がいらない変更に' },
                        { value: 'draft', label: '新しい改定案として保存', icon: 'i-lucide-git-branch', description: '現行版はそのまま。確認が済んだら「現行版に反映」します' },
                    ]" />
                </UFormField>
                <UFormField v-if="target === 'draft'" label="改定案の名前" description="例：2026年4月改定">
                    <UInput v-model="draftName" class="cd-full" />
                </UFormField>
                <UAlert v-if="!onMain" color="warning" variant="subtle" icon="i-lucide-file-pen-line"
                    :title="`保存先：改定案「${branchLabel}」（現行版には影響しません）`" />
                <UFormField label="何を変えたか" description="例：第12条 契約期間を2年に変更">
                    <template v-if="aiReady" #hint>
                        <UButton label="AI で下書き" icon="i-lucide-sparkles" size="xs" color="neutral" variant="ghost"
                            :loading="drafting" title="保存していない変更を AI に渡して、説明を作ります" @click="draftMessage" />
                    </template>
                    <UTextarea v-model="message" :rows="3" class="cd-full" autofocus />
                </UFormField>
                <div v-if="target === 'here'" class="row">
                    <UCheckbox v-model="withDate" label="施行日を記録する" />
                    <DateField v-if="withDate" v-model="date" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton label="やめる" color="neutral" variant="outline" @click="emit('close')" />
                <UButton label="保存" :disabled="!canSave" :loading="busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.row {
    display: flex;
    gap: 12px;
    align-items: center;
}
</style>
