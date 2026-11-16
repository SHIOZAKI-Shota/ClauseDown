<script setup lang="ts">
import type { ReceivedPdf } from '@shared/api'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import { fmtDate } from '~/utils/format'

const props = defineProps<{ pdf: ReceivedPdf; deliveryId: string }>()
const emit = defineEmits<{ close: []; done: [string] }>()
const app = useApp()
const t = useT()
const c = computed(() => t.value.signing.received)
const busy = ref(false)

async function save() {
    if (!app.repoDir) return
    busy.value = true
    try {
        const out = await app.run(() => window.api.saveReceivedPdf({ path: props.pdf.path, dir: app.repoDir!, deliveryId: props.deliveryId }))
        if (!out) return
        app.notifyExported(c.value.done(out), out)
        emit('done', out)
        emit('close')
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <UModal :open="true" :title="c.title" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div class="cd-form">
                <p class="file">{{ c.file(pdf.name) }}</p>
                <div>
                    <p class="label">{{ c.existing }}</p>
                    <ul v-if="pdf.signatures.length" class="sigs">
                        <li v-for="(s, i) in pdf.signatures" :key="i">
                            <UIcon name="i-lucide-pen-line" />
                            <span>{{ s.signer || c.unknownSigner }}</span>
                            <span v-if="s.signedAt" class="cd-muted">{{ fmtDate(s.signedAt, 'ymdhm') }}</span>
                        </li>
                    </ul>
                    <p v-else class="cd-muted">{{ c.none }}</p>
                </div>
                <p class="cd-muted note">{{ c.note }}</p>
            </div>
        </template>
        <template #footer>
            <div class="footer">
                <UButton :label="t.common.cancel" color="neutral" variant="ghost" @click="emit('close')" />
                <UButton :label="c.save" icon="i-lucide-file-check" :loading="busy" @click="save" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.file {
    margin: 0;
    font-weight: 500;
    word-break: break-all;
}
.label {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--ui-text-muted);
}
.sigs {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.sigs li {
    display: flex;
    align-items: center;
    gap: 6px;
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
