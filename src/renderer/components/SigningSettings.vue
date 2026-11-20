<script setup lang="ts">
import { useConfirm } from '~/composables/useConfirm'
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import type { CertInfo, DeepPartial, MynaStatus, SealMeta, SigningStatus } from '@shared/api'
import { TSA_PRESETS, type CommitSignMode, type KeyStorage, type PdfCertEntry, type SigningSettings } from '@shared/signing'
import { FORGE_LABEL } from '@shared/forge'
import { isEnabled } from '@shared/experiments'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import { useStoredRef } from '~/composables/useStoredRef'

const app = useApp()
const t = useT()
const ask = useConfirm()
const s = computed(() => t.value.signing)

const status = ref<SigningStatus | null>(null)
const myna = ref<MynaStatus | null>(null)
const manual = ref<Record<string, string>>({})
const busy = ref(false)

async function refresh() {
    status.value = (await app.run(() => window.api.signingStatus(app.repoDir ?? undefined))) ?? null
    if (status.value?.signing.pdf.certs.some((c) => c.kind === 'myna')) myna.value = (await app.run(() => window.api.mynaStatus())) ?? null
}
onMounted(refresh)

const cfg = computed(() => status.value?.signing)
type SignTab = 'versions' | 'pdf' | 'markdown' | 'seals'
const cdsign = computed(() => isEnabled(app.settings, 'cdsign'))
const mdCfg = computed(() => cfg.value?.md)
const mdAppKey = computed(() => !!cfg.value?.commit.key && cfg.value.commit.key.storage !== 'chip')
const storedTab = useStoredRef<SignTab>('clausedown.signing.tab', 'versions')
const tab = computed<SignTab>({
    get: () => (storedTab.value === 'markdown' && !cdsign.value ? 'versions' : storedTab.value),
    set: (v) => (storedTab.value = v),
})
const tabItems = computed(() => [
    { value: 'versions', label: s.value.tabs.versions },
    { value: 'pdf', label: s.value.tabs.pdf },
    ...(cdsign.value ? [{ value: 'markdown', label: s.value.tabs.markdown }] : []),
    { value: 'seals', label: s.value.tabs.seals },
])
async function patch(p: DeepPartial<SigningSettings>) {
    const next = await app.run(() => window.api.setSigningPrefs(p))
    if (next && status.value) status.value = { ...status.value, signing: next }
}

const modeItems = computed<SegmentItem<CommitSignMode>[]>(() =>
    (['off', 'app', 'external'] as const).map((value) => ({ value, label: s.value.commit.modes[value] })),
)

const keyStorage = computed<KeyStorage>(() => cfg.value?.commit.key?.storage ?? 'app')
const storage = ref<KeyStorage>('app')
watch(
    () => [status.value?.chip, cfg.value?.commit.key?.storage] as const,
    ([chip, current]) => (storage.value = current ?? (chip ? 'chip' : 'app')),
    { immediate: true },
)
const storageItems = computed<SegmentItem<KeyStorage>[]>(() => [
    { value: 'chip', ...s.value.commit.storageOptions.chip },
    { value: 'app', ...s.value.commit.storageOptions.app },
])

async function createKey() {
    if (
        cfg.value?.commit.key &&
        !(await ask({ title: s.value.commit.recreate, description: s.value.commit.confirmRecreate, confirmLabel: s.value.commit.recreate, color: 'error' }))
    )
        return
    busy.value = true
    const next = await app.run(() => window.api.generateSigningKey(status.value?.chip ? storage.value : 'app'))
    busy.value = false
    if (next) status.value = next
}
async function removeKey() {
    if (!(await ask({ title: s.value.commit.confirmRemove, confirmLabel: t.value.common.delete, color: 'error' }))) return
    const next = await app.run(() => window.api.deleteSigningKey())
    if (next) status.value = next
}
async function copyPublic() {
    if (!cfg.value?.commit.key) return
    await app.copy(cfg.value.commit.key.publicKey, s.value.commit.copied)
}
async function register(base: string) {
    const r = await app.run(() => window.api.registerSigningKey(base))
    if (!r) return
    if (r.ok) {
        delete manual.value[base]
        await refresh()
    } else if (r.manualUrl) manual.value = { ...manual.value, [base]: r.manualUrl }
}
const openManual = (url: string) => window.api.openExternal(url)
async function testExternal() {
    await app.run(() => window.api.testExternalSigning(app.repoDir ?? undefined), s.value.commit.testOk)
}
async function publishKey() {
    if (!app.repoDir) return
    await app.run(() => window.api.publishSigningKey(app.repoDir!), s.value.approvals.published)
}
const registeredAt = (base: string) => cfg.value?.commit.registered[base]?.at?.slice(0, 10)

const certs = computed(() => cfg.value?.pdf.certs ?? [])
const adding = ref<'p12' | 'self' | null>(null)
const newLabel = ref('')
const addItems = computed(() => [
    [
        { label: s.value.pdf.addKinds.p12, icon: 'i-lucide-file-key', onSelect: () => startAdd('p12') },
        { label: s.value.pdf.addKinds.self, icon: 'i-lucide-badge-check', onSelect: () => startAdd('self') },
        ...(status.value?.myna && !certs.value.some((c) => c.kind === 'myna')
            ? [{ label: s.value.pdf.addKinds.myna, icon: 'i-lucide-id-card', onSelect: () => void addMyna() }]
            : []),
    ],
])
function startAdd(kind: 'p12' | 'self') {
    adding.value = kind
    newLabel.value = ''
    p12File.value = null
    p12Password.value = ''
}

const p12Input = ref<HTMLInputElement | null>(null)
const p12File = ref<Uint8Array | null>(null)
const p12Password = ref('')
function pickP12() {
    p12Input.value?.click()
}
async function onP12(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    p12File.value = new Uint8Array(await f.arrayBuffer())
    p12Password.value = ''
    ;(e.target as HTMLInputElement).value = ''
}
async function importP12() {
    if (!p12File.value) return
    const cert = await app.run(() => window.api.importPdfCert(p12File.value!, p12Password.value, newLabel.value), s.value.pdf.imported)
    p12Password.value = ''
    if (cert) {
        p12File.value = null
        adding.value = null
        await refresh()
    }
}

const self = reactive({ name: app.settings?.author.name ?? '', org: '', email: app.settings?.author.email ?? '', years: 3 })
async function createSelf() {
    const cert = await app.run(() => window.api.createSelfSignedCert({ ...self, label: newLabel.value }), s.value.pdf.created)
    if (cert) {
        adding.value = null
        await refresh()
    }
}
async function addMyna() {
    const cert = await app.run(() => window.api.addMynaCert())
    if (cert) await refresh()
}

function applySigning(next: SigningSettings | undefined | null) {
    if (next && status.value) status.value = { ...status.value, signing: next }
}
async function removeCert(c: PdfCertEntry) {
    if (!(await ask({ title: s.value.pdf.confirmRemove(c.label || s.value.pdf.kinds[c.kind]), confirmLabel: t.value.common.delete, color: 'error' }))) return
    applySigning(await app.run(() => window.api.removePdfCert(c.id)))
}
async function makeDefault(c: PdfCertEntry) {
    applySigning(await app.run(() => window.api.setDefaultPdfCert(c.id)))
}
const exportCer = (c: PdfCertEntry) => app.run(() => window.api.exportPdfCert(c.id))

const editing = ref<string | null>(null)
const draft = reactive({ label: '', reason: '', location: '', contactInfo: '' })
function startEdit(c: PdfCertEntry) {
    editing.value = c.id
    Object.assign(draft, { label: c.label, reason: c.reason ?? '', location: c.location ?? '', contactInfo: c.contactInfo ?? '' })
}
async function saveEdit() {
    if (!editing.value) return
    applySigning(await app.run(() => window.api.updatePdfCert(editing.value!, { ...draft })))
    editing.value = null
}

const DAY = 86_400_000
function expiry(c: PdfCertEntry): { level: 'error' | 'warning'; text: string } | null {
    if (!c.cert) return null
    const left = new Date(c.cert.notAfter).getTime() - Date.now()
    const date = c.cert.notAfter.slice(0, 10)
    if (left < 0) return { level: 'error', text: s.value.pdf.expired(date) }
    if (left < 30 * DAY) return { level: 'warning', text: s.value.pdf.expiring(date) }
    return null
}

const certRows = (c: CertInfo) => [
    [s.value.pdf.subject, c.subject + (c.email ? ` <${c.email}>` : '')],
    [s.value.pdf.issuer, c.selfSigned ? s.value.pdf.kinds.self : c.issuer],
    [s.value.pdf.valid, `${c.notBefore.slice(0, 10)} – ${c.notAfter.slice(0, 10)}`],
    [s.value.pdf.fingerprint, c.fingerprint.slice(0, 23) + '…'],
]

const tsaItems = computed(() => TSA_PRESETS.map((p) => ({ value: p.id, label: s.value.pdf.tsaPresets[p.id as keyof typeof s.value.pdf.tsaPresets] })))
const tsaPreset = computed(() => TSA_PRESETS.find((p) => p.id === cfg.value?.pdf.tsa.preset))
function setPreset(id: string) {
    const p = TSA_PRESETS.find((x) => x.id === id)
    void patch({ pdf: { tsa: { preset: id, url: p?.url ?? '' } } })
}
const tsaPassword = ref('')
async function saveTsaPassword() {
    await app.run(() => window.api.setTsaPassword(tsaPassword.value))
    tsaPassword.value = ''
    await refresh()
}
const testTsa = () => app.run(() => window.api.testTimestamp(), s.value.pdf.tsaOk)

const seals = ref<SealMeta[]>([])
const sealUrls = ref<Record<string, string>>({})
const sealOpen = ref(false)
async function loadSeals() {
    seals.value = (await app.run(() => window.api.listSeals())) ?? []
    for (const seal of seals.value) {
        if (sealUrls.value[seal.id]) continue
        const png = await window.api.readSeal(seal.id).catch(() => null)
        if (png) sealUrls.value = { ...sealUrls.value, [seal.id]: URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })) }
    }
}
onMounted(loadSeals)
onBeforeUnmount(() => Object.values(sealUrls.value).forEach((u) => URL.revokeObjectURL(u)))
async function removeSeal(id: string) {
    if (!(await ask({ title: s.value.seals.confirmRemove, confirmLabel: t.value.common.delete, color: 'error' }))) return
    await app.run(() => window.api.deleteSeal(id))
    await loadSeals()
}

const mynaLine = computed(() => {
    const m = myna.value
    if (!m) return ''
    if (!m.available) return s.value.myna.notIncluded
    if (!m.reader) return s.value.myna.noReader
    if (!m.card) return s.value.myna.noCard
    if (!m.signCert) return s.value.myna.noSignCert
    return m.retries === null ? s.value.myna.reader(m.reader) : `${s.value.myna.reader(m.reader)} ・ ${s.value.myna.retries(m.retries)}`
})
async function refreshMyna() {
    myna.value = (await app.run(() => window.api.mynaStatus())) ?? null
}
</script>

<template>
    <div v-if="cfg" class="signing">
        <UTabs v-model="tab" :items="tabItems" :content="false" size="sm" variant="link" class="tabs" />
        <template v-if="tab === 'versions'">
            <h3 class="cd-subhead">{{ s.commit.heading }}</h3>
            <SettingRow :label="s.commit.mode" :description="s.commit.modeDesc">
                <SegmentSwitch :model-value="cfg.commit.mode" :items="modeItems" @update:model-value="(v) => v && patch({ commit: { mode: v } })" />
            </SettingRow>
            <template v-if="cfg.commit.mode === 'app'">
                <SettingRow
                    v-if="status?.chip"
                    :label="s.commit.storage"
                    :description="cfg.commit.key && storage !== keyStorage ? s.commit.storageChange : s.commit.storageDesc"
                >
                    <SegmentSwitch v-model="storage" :items="storageItems" />
                </SettingRow>
                <SettingRow :label="s.commit.key" :description="keyStorage === 'chip' ? s.commit.keyDescChip : s.commit.keyDesc">
                    <UBadge v-if="cfg.commit.key" :label="s.commit.storages[keyStorage]" color="neutral" variant="subtle" />
                    <code v-if="cfg.commit.key" class="fp">{{ cfg.commit.key.fingerprint }}</code>
                    <span v-else class="cd-muted">{{ s.commit.noKey }}</span>
                    <UButton
                        v-if="cfg.commit.key"
                        :label="s.commit.copyPublic"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-copy"
                        @click="copyPublic"
                    />
                    <UButton
                        :label="cfg.commit.key ? s.commit.recreate : s.commit.create"
                        size="sm"
                        :loading="busy"
                        :variant="cfg.commit.key ? 'ghost' : 'solid'"
                        :color="cfg.commit.key ? 'neutral' : 'primary'"
                        @click="createKey"
                    />
                    <UButton v-if="cfg.commit.key" :label="s.commit.remove" size="sm" color="error" variant="ghost" @click="removeKey" />
                </SettingRow>
                <template v-if="cfg.commit.key">
                    <SettingRow
                        v-for="acc in app.accounts.filter((a) => a.login)"
                        :key="acc.base"
                        :label="s.commit.register(FORGE_LABEL[acc.kind], acc.login ?? '')"
                        :description="manual[acc.base] ? s.commit.manual : s.commit.registerDesc"
                    >
                        <span v-if="registeredAt(acc.base)" class="cd-muted">{{ s.commit.registered(registeredAt(acc.base)!) }}</span>
                        <template v-if="manual[acc.base]">
                            <UButton :label="s.commit.copyPublic" size="sm" color="neutral" variant="outline" icon="i-lucide-copy" @click="copyPublic" />
                            <UButton
                                :label="s.commit.openPage"
                                size="sm"
                                color="neutral"
                                variant="outline"
                                icon="i-lucide-external-link"
                                @click="openManual(manual[acc.base])"
                            />
                        </template>
                        <UButton
                            v-else-if="!registeredAt(acc.base)"
                            :label="s.commit.registerButton"
                            size="sm"
                            color="neutral"
                            variant="outline"
                            @click="register(acc.base)"
                        />
                    </SettingRow>
                </template>
            </template>
            <SettingRow v-if="cfg.commit.mode === 'external'" :label="s.commit.external" :description="s.commit.externalDesc">
                <code v-if="status?.external" class="fp">{{ status.external.format }} · {{ status.external.key }}</code>
                <span v-else class="cd-muted">{{ s.commit.externalNone }}</span>
                <UButton :label="s.commit.test" size="sm" color="neutral" variant="outline" @click="testExternal" />
            </SettingRow>
            <SettingRow v-if="cfg.commit.mode !== 'off'" :label="s.commit.localMerge" :description="s.commit.localMergeDesc">
                <USwitch :model-value="cfg.commit.localMerge" @update:model-value="(v: boolean) => patch({ commit: { localMerge: v } })" />
            </SettingRow>

            <h3 class="cd-subhead">{{ s.approvals.heading }}</h3>
            <SettingRow :label="s.approvals.sign" :description="cfg.commit.key ? s.approvals.signDesc : s.approvals.needKey">
                <USwitch
                    :model-value="cfg.approvals.sign"
                    :disabled="!cfg.commit.key"
                    @update:model-value="(v: boolean) => patch({ approvals: { sign: v } })"
                />
            </SettingRow>
            <SettingRow v-if="cfg.commit.key && app.repoDir" :label="s.approvals.publish" :description="s.approvals.publishDesc">
                <UButton :label="s.approvals.publishButton" size="sm" color="neutral" variant="outline" @click="publishKey" />
            </SettingRow>
        </template>
        <template v-else-if="tab === 'pdf'">
            <p class="cd-muted note">{{ s.pdf.certsDesc }}</p>
            <div v-for="c in certs" :key="c.id" class="cert">
                <div class="cert-head">
                    <span class="cert-name">{{ c.label || s.pdf.kinds[c.kind] }}</span>
                    <span class="cd-chip">{{ s.pdf.kinds[c.kind] }}</span>
                    <UBadge v-if="cfg.pdf.defaultCert === c.id" :label="s.pdf.default" color="primary" variant="subtle" size="sm" />
                    <UBadge v-if="expiry(c)" :label="expiry(c)!.text" :color="expiry(c)!.level" variant="subtle" size="sm" />
                    <span class="cd-grow" />
                    <UButton v-if="cfg.pdf.defaultCert !== c.id" :label="s.pdf.makeDefault" size="xs" color="neutral" variant="ghost" @click="makeDefault(c)" />
                    <UButton :label="s.pdf.edit" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" @click="startEdit(c)" />
                    <UButton
                        v-if="c.kind !== 'myna'"
                        :label="s.pdf.exportCer"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-download"
                        @click="exportCer(c)"
                    />
                    <UButton :label="s.pdf.removeCert" size="xs" color="error" variant="ghost" @click="removeCert(c)" />
                </div>
                <dl v-if="c.cert">
                    <template v-for="[k, v] in certRows(c.cert)" :key="k">
                        <dt>{{ k }}</dt>
                        <dd>{{ v }}</dd>
                    </template>
                </dl>
                <template v-if="c.kind === 'myna'">
                    <div class="myna">
                        <span class="cd-muted">{{ mynaLine }}</span>
                        <UButton :label="s.myna.refresh" size="xs" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refreshMyna" />
                    </div>
                    <p class="cd-muted note">{{ s.myna.disclosure }}</p>
                </template>
                <p v-if="c.cert?.selfSigned" class="cd-muted note">{{ s.pdf.selfNote }}</p>
                <div v-if="editing === c.id" class="edit">
                    <UFormField :label="s.pdf.label" :help="s.pdf.labelHint"><UInput v-model="draft.label" class="cd-w-input" /></UFormField>
                    <UFormField :label="s.pdf.reason" :help="s.pdf.overrideHint"
                        ><UInput v-model="draft.reason" :placeholder="cfg.pdf.reason" class="cd-w-input"
                    /></UFormField>
                    <UFormField :label="s.pdf.location"><UInput v-model="draft.location" :placeholder="cfg.pdf.location" class="cd-w-input" /></UFormField>
                    <UFormField :label="s.pdf.contact"><UInput v-model="draft.contactInfo" :placeholder="cfg.pdf.contactInfo" class="cd-w-input" /></UFormField>
                    <div class="actions">
                        <UButton :label="t.common.cancel" size="sm" color="neutral" variant="outline" @click="editing = null" />
                        <UButton :label="t.common.save" size="sm" @click="saveEdit" />
                    </div>
                </div>
            </div>
            <p v-if="!certs.length" class="cd-muted note">{{ s.pdf.noCerts }}</p>
            <UDropdownMenu :items="addItems">
                <UButton :label="s.pdf.addCert" size="sm" color="neutral" variant="outline" icon="i-lucide-plus" class="self-start" />
            </UDropdownMenu>

            <div v-if="adding" class="cert add">
                <UFormField :label="s.pdf.label" :help="s.pdf.labelHint"><UInput v-model="newLabel" class="cd-w-input" /></UFormField>
                <template v-if="adding === 'p12'">
                    <input ref="p12Input" type="file" accept=".p12,.pfx,application/x-pkcs12" hidden @change="onP12" />
                    <UFormField :label="s.pdf.importP12">
                        <UButton :label="s.pdf.pickP12" size="sm" color="neutral" variant="outline" icon="i-lucide-file-key" @click="pickP12" />
                        <span v-if="p12File" class="cd-muted picked">{{ s.pdf.p12Picked }}</span>
                    </UFormField>
                    <UFormField v-if="p12File" :label="s.pdf.password">
                        <UInput v-model="p12Password" type="password" autocomplete="off" class="cd-w-input" @keydown.enter="importP12" />
                    </UFormField>
                    <div class="actions">
                        <UButton :label="t.common.cancel" size="sm" color="neutral" variant="outline" @click="adding = null" />
                        <UButton :label="s.pdf.importP12" size="sm" :disabled="!p12File" @click="importP12" />
                    </div>
                </template>
                <template v-else>
                    <UFormField :label="s.pdf.selfName"><UInput v-model="self.name" class="cd-w-input" /></UFormField>
                    <UFormField :label="s.pdf.selfOrg"><UInput v-model="self.org" class="cd-w-input" /></UFormField>
                    <UFormField :label="s.pdf.selfEmail"><UInput v-model="self.email" type="email" class="cd-w-input" /></UFormField>
                    <UFormField :label="s.pdf.selfYears" :help="s.pdf.selfNote">
                        <UInput v-model.number="self.years" type="number" min="1" max="10" class="cd-w-small" />
                    </UFormField>
                    <div class="actions">
                        <UButton :label="t.common.cancel" size="sm" color="neutral" variant="outline" @click="adding = null" />
                        <UButton :label="s.pdf.createSelf" size="sm" :disabled="!self.name.trim()" @click="createSelf" />
                    </div>
                </template>
            </div>

            <template v-if="certs.length">
                <SettingRow :label="s.pdf.onExport">
                    <USwitch :model-value="cfg.pdf.onExport" @update:model-value="(v: boolean) => patch({ pdf: { onExport: v } })" />
                </SettingRow>
                <SettingRow :label="s.pdf.onDeliver">
                    <USwitch :model-value="cfg.pdf.onDeliver" @update:model-value="(v: boolean) => patch({ pdf: { onDeliver: v } })" />
                </SettingRow>
                <SettingRow :label="s.pdf.reasonCommon" :description="s.pdf.commonDesc">
                    <UInput
                        :model-value="cfg.pdf.reason"
                        class="cd-w-input"
                        @change="(e: Event) => patch({ pdf: { reason: (e.target as HTMLInputElement).value } })"
                    />
                </SettingRow>
                <SettingRow :label="s.pdf.locationCommon">
                    <UInput
                        :model-value="cfg.pdf.location"
                        class="cd-w-input"
                        @change="(e: Event) => patch({ pdf: { location: (e.target as HTMLInputElement).value } })"
                    />
                </SettingRow>
                <SettingRow :label="s.pdf.contactCommon">
                    <UInput
                        :model-value="cfg.pdf.contactInfo"
                        class="cd-w-input"
                        @change="(e: Event) => patch({ pdf: { contactInfo: (e.target as HTMLInputElement).value } })"
                    />
                </SettingRow>
                <SettingRow :label="s.pdf.tsa" :description="s.pdf.tsaDesc">
                    <USwitch :model-value="cfg.pdf.tsa.enabled" @update:model-value="(v: boolean) => patch({ pdf: { tsa: { enabled: v } } })" />
                </SettingRow>
                <template v-if="cfg.pdf.tsa.enabled">
                    <SettingRow :label="s.pdf.tsaPreset" :description="tsaPreset?.certified ? s.pdf.tsaCertified : undefined">
                        <USelect :model-value="cfg.pdf.tsa.preset" :items="tsaItems" class="cd-w-input" @update:model-value="(v: string) => setPreset(v)" />
                        <UButton :label="s.pdf.tsaTest" size="sm" color="neutral" variant="outline" @click="testTsa" />
                    </SettingRow>
                    <SettingRow :label="s.pdf.tsaUrl">
                        <UInput
                            :model-value="cfg.pdf.tsa.url"
                            placeholder="https://"
                            class="cd-w-input"
                            @change="(e: Event) => patch({ pdf: { tsa: { url: (e.target as HTMLInputElement).value } } })"
                        />
                    </SettingRow>
                    <template v-if="tsaPreset?.auth">
                        <SettingRow :label="s.pdf.tsaUser">
                            <UInput
                                :model-value="cfg.pdf.tsa.user"
                                class="cd-w-input"
                                @change="(e: Event) => patch({ pdf: { tsa: { user: (e.target as HTMLInputElement).value } } })"
                            />
                        </SettingRow>
                        <SettingRow :label="s.pdf.tsaPassword">
                            <UInput
                                v-model="tsaPassword"
                                type="password"
                                autocomplete="off"
                                :placeholder="status?.hasTsaPassword ? '••••••••' : ''"
                                class="cd-w-input"
                                @change="saveTsaPassword"
                            />
                        </SettingRow>
                    </template>
                </template>
                <SettingRow v-if="certs.some((c) => c.kind !== 'myna')" :label="s.pdf.longTerm" :description="s.pdf.longTermDesc">
                    <USwitch
                        :model-value="cfg.pdf.longTerm"
                        :disabled="!cfg.pdf.tsa.enabled"
                        @update:model-value="(v: boolean) => patch({ pdf: { longTerm: v } })"
                    />
                </SettingRow>
            </template>
        </template>
        <MdSigningSettings v-else-if="tab === 'markdown' && cdsign && mdCfg" :md="mdCfg" :app-key="mdAppKey" @changed="refresh" />
        <template v-else>
            <p class="cd-muted note">{{ s.seals.desc }}</p>
            <div class="seals">
                <figure v-for="seal in seals" :key="seal.id" class="seal">
                    <img v-if="sealUrls[seal.id]" :src="sealUrls[seal.id]" :alt="seal.label" />
                    <figcaption>
                        <span>{{ seal.label || s.seals.kinds[seal.kind] }}</span>
                        <UButton icon="i-lucide-trash-2" size="xs" color="error" variant="ghost" :aria-label="s.seals.remove" @click="removeSeal(seal.id)" />
                    </figcaption>
                </figure>
                <span v-if="!seals.length" class="cd-muted">{{ s.seals.empty }}</span>
            </div>
            <UButton :label="s.seals.create" size="sm" color="neutral" variant="outline" icon="i-lucide-stamp" class="self-start" @click="sealOpen = true" />
            <SealModal v-model:open="sealOpen" library @saved="loadSeals" />
        </template>
    </div>
</template>

<style scoped>
.signing {
    display: flex;
    flex-direction: column;
}
.cd-subhead {
    margin: 20px 0 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text-muted);
}
.cd-subhead:first-child {
    margin-top: 0;
}
.tabs {
    margin-bottom: 12px;
}
.fp {
    font-size: 12px;
    word-break: break-all;
}
.note {
    font-size: 12px;
    margin: 4px 0 8px;
}
.cert {
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    padding: 12px 14px;
    margin: 8px 0;
}
.cert dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 0;
    font-size: 13px;
}
.cert dt {
    color: var(--ui-text-muted);
}
.cert dd {
    margin: 0;
    word-break: break-all;
}
.cert .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
}
.cert-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}
.cert-name {
    font-weight: 600;
}
.myna {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}
.edit,
.add {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.edit {
    border-top: 1px solid var(--ui-border);
    margin-top: 10px;
    padding-top: 10px;
}
.picked {
    margin-left: 8px;
    font-size: 12px;
}
.seals {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 4px 0 12px;
}
.seal {
    margin: 0;
    width: 112px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    padding: 8px;
}
.seal img {
    display: block;
    width: 100%;
    height: 72px;
    object-fit: contain;
}
.seal figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    margin-top: 4px;
}
</style>
