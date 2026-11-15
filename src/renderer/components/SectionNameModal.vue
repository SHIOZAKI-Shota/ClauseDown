<script setup lang="ts">
import { cleanSection, sectionNames } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ dir?: string; from?: string }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()
const t = useT()
const name = ref(props.from ?? '')
const value = computed(() => cleanSection(name.value))
const taken = computed(() => !!value.value && value.value !== props.from && sectionNames(app.settings?.repos ?? []).includes(value.value))

async function save() {
    if (!value.value) return
    if (props.from) await app.renameRepoSection(props.from, value.value)
    else if (props.dir) await app.moveRepo(props.dir, { section: value.value })
    emit('close')
}
</script>

<template>
    <UModal :open="true" :title="from ? t.repo.sectionName.renameTitle : t.repo.sectionName.newTitle" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <UFormField :label="t.repo.sectionName.label" :description="taken ? t.repo.sectionName.taken : undefined">
                    <UInput v-model="name" class="cd-full" autofocus @keydown.enter="save" />
                </UFormField>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.repo.cancel" color="neutral" variant="outline" @click="emit('close')" />
                <UButton :label="from ? t.repo.sectionName.rename : t.repo.sectionName.create" :disabled="!value" :loading="app.busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>
