<script setup lang="ts">
import { DEFAULT_SIGN_PAGE, resolveMdKey, validSigner, type MdKeyEntry, type MdRequirement, type MdSigningSettings } from '@shared/mdsig'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const props = defineProps<{ path: string; title: string; oid?: string; versionLabel?: string; hasImages?: boolean }>()
const emit = defineEmits<{ close: []; done: [string] }>()
const app = useApp()
const t = useT()
const e = computed(() => t.value.mdsig.export)

const md = ref<MdSigningSettings | null>(null)
const keyId = ref('')
const rows = ref<MdRequirement[]>([])
const sequential = ref(false)
const busy = ref(false)

onMounted(async () => {
    const st = await app.run(() => window.api.signingStatus(app.repoDir ?? undefined))
    md.value = st?.signing.md ?? null
    if (!md.value) return
    keyId.value = resolveMdKey(md.value, app.repoDir ?? undefined)?.id ?? ''
    rows.value = md.value.lastRequire.length ? md.value.lastRequire.map((r) => ({ ...r })) : [{ method: 'directory', signer: '' }]
})

const keys = computed<MdKeyEntry[]>(() => md.value?.keys ?? [])
const keyItems = computed(() =>
    keys.value.map((k) => ({ value: k.id, label: `${k.label || `${k.method}:${k.signer}`}（${t.value.mdsig.settings.kinds[k.kind]}）` })),
)
const methodItems = ['dns', 'directory', 'tofu'].map((v) => ({ value: v, label: v }))
const filled = computed(() => rows.value.filter((r) => r.signer.trim()))
const valid = computed(() => !!keyId.value && filled.value.every((r) => validSigner(r.method, r.signer.trim()) && (!r.role || /^\S+$/.test(r.role))))

function addRow() {
    rows.value.push({ method: 'directory', signer: '' })
}
function removeRow(i: number) {
    rows.value.splice(i, 1)
}
function openSettings() {
    emit('close')
    app.openSettings('setup', 'signature')
}

async function write() {
    if (!app.repoDir || !valid.value) return
    busy.value = true
    try {
        const require = filled.value.map((r) => ({ method: r.method, signer: r.signer.trim(), ...(r.role?.trim() ? { role: r.role.trim() } : {}) }))
        const out = await app.run(() =>
            window.api.exportCdsign({
                dir: app.repoDir!,
                path: props.path,
                title: props.title,
                keyId: keyId.value,
                require,
                sequential: sequential.value,
                oid: props.oid,
            }),
        )
        if (!out) return
        app.notifyExported(e.value.done(out), out)
        emit('done', out)
        emit('close')
    } finally {
        busy.value = false
    }
}

async function copyMessage() {
    await navigator.clipboard.writeText(e.value.messageText(props.title, DEFAULT_SIGN_PAGE))
    app.notify(t.value.mdsig.settings.copied)
}
</script>

<template>
    <UModal :open="true" :title="e.title" @update:open="(v) => !v && emit('close')">
        <template #body>
            <div v-if="md" class="cd-form">
                <p v-if="versionLabel" class="cd-muted ver">{{ e.version(versionLabel) }}</p>
                <template v-if="keys.length">
                    <UFormField :label="e.key">
                        <USelect v-model="keyId" :items="keyItems" class="cd-full" />
                    </UFormField>
                    <UFormField :label="e.require" :help="e.requireDesc">
                        <div class="rows">
                            <div v-for="(r, i) in rows" :key="i" class="row">
                                <USelect v-model="r.method" :items="methodItems" size="sm" class="method" />
                                <UInput
                                    v-model="r.signer"
                                    size="sm"
                                    :placeholder="t.mdsig.settings.signerHint[r.method as 'dns' | 'directory' | 'tofu']"
                                    class="signer"
                                />
                                <UInput v-model="r.role" size="sm" :placeholder="e.role" class="role" />
                                <UButton
                                    icon="i-lucide-x"
                                    size="xs"
                                    color="neutral"
                                    variant="ghost"
                                    :aria-label="t.mdsig.settings.remove"
                                    @click="removeRow(i)"
                                />
                            </div>
                            <UButton
                                :label="e.addRequire"
                                icon="i-lucide-plus"
                                size="xs"
                                color="neutral"
                                variant="outline"
                                class="self-start"
                                @click="addRow"
                            />
                        </div>
                    </UFormField>
                    <UCheckbox v-if="filled.length > 1" v-model="sequential" :label="e.sequential" :description="e.sequentialDesc" />
                    <p v-if="hasImages" class="cd-muted note">{{ e.images }}</p>
                </template>
                <div v-else class="none">
                    <p class="cd-muted">{{ e.noKeys }}</p>
                    <UButton :label="e.openSettings" size="sm" color="neutral" variant="outline" @click="openSettings" />
                </div>
            </div>
        </template>
        <template #footer>
            <div class="footer">
                <UButton :label="e.message" icon="i-lucide-copy" color="neutral" variant="ghost" @click="copyMessage" />
                <span class="grow" />
                <UButton :label="t.common.cancel" color="neutral" variant="ghost" @click="emit('close')" />
                <UButton :label="e.write" icon="i-lucide-signature" :loading="busy" :disabled="!valid" @click="write" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.ver,
.note {
    margin: 0;
    font-size: 12px;
}
.rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) 110px auto;
    gap: 6px;
    align-items: center;
}
.none {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
}
.footer {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}
.grow {
    flex: 1;
}
</style>
