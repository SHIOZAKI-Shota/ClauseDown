<script setup lang="ts">
import { usePdfSign } from '~/composables/usePdfSign'
import { useT } from '~/composables/useT'

const { prompt } = usePdfSign()
const t = useT()
const m = computed(() => t.value.signing.myna)
const pin = ref('')
const valid = computed(() => /^[0-9A-Za-z]{6,16}$/.test(pin.value))
const retries = computed(() => prompt.value?.myna?.retries ?? null)

watch(prompt, () => (pin.value = ''))

function cancel() {
    prompt.value?.resolve(null)
}
function submit() {
    if (!valid.value || !prompt.value) return
    if (retries.value === 1 && !confirm(m.value.lastTry)) return
    const value = pin.value.toUpperCase()
    pin.value = ''
    prompt.value.resolve(value)
}
</script>

<template>
    <UModal :open="!!prompt" :title="m.pinTitle" @update:open="(v) => !v && cancel()">
        <template #body>
            <div v-if="prompt" class="cd-form">
                <p class="target">{{ m.target(prompt.name) }}</p>
                <UAlert color="warning" variant="subtle" icon="i-lucide-id-card" :description="m.disclosure" />
                <UFormField :label="m.pinLabel" :help="retries !== null ? m.retries(retries) : m.lockNote">
                    <UInput v-model="pin" type="password" autocomplete="off" autofocus class="cd-full" @keydown.enter="submit" />
                </UFormField>
                <p v-if="retries !== null" class="cd-muted note">{{ m.lockNote }}</p>
            </div>
        </template>
        <template #footer>
            <div class="footer">
                <UButton :label="t.common.cancel" color="neutral" variant="ghost" @click="cancel" />
                <UButton :label="m.sign" :disabled="!valid" icon="i-lucide-pen-line" @click="submit" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.target {
    margin: 0;
    font-weight: 500;
}
.note {
    font-size: 12px;
    margin: 0;
}
.footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    width: 100%;
}
</style>
