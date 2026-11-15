<script setup lang="ts">
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import type { CertInfo, DeepPartial, MynaStatus, SealMeta, SigningStatus } from '@shared/api'
import { TSA_PRESETS, type CommitSignMode, type PdfSignMethod, type SigningSettings } from '@shared/signing'
import { FORGE_LABEL } from '@shared/forge'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'

const app = useApp()
const t = useT()
const s = computed(() => t.value.signing)

const status = ref<SigningStatus | null>(null)
const myna = ref<MynaStatus | null>(null)
const manual = ref<Record<string, string>>({})
const busy = ref(false)

async function refresh() {
    status.value = (await app.run(() => window.api.signingStatus(app.repoDir ?? undefined))) ?? null
    if (status.value?.signing.pdf.method === 'myna' || status.value?.myna) myna.value = (await app.run(() => window.api.mynaStatus())) ?? null
}
onMounted(refresh)

const cfg = computed(() => status.value?.signing)
async function patch(p: DeepPartial<SigningSettings>) {
    const next = await app.run(() => window.api.setSigningPrefs(p))
    if (next && status.value) status.value = { ...status.value, signing: next }
}

const modeItems = computed<SegmentItem<CommitSignMode>[]>(() =>
    (['off', 'app', 'external'] as const).map((value) => ({ value, label: s.value.commit.modes[value] })),
)
const methodItems = computed<SegmentItem<PdfSignMethod>[]>(() =>
    (['none', 'p12', 'self', 'myna'] as const).filter((m) => m !== 'myna' || status.value?.myna).map((value) => ({ value, label: s.value.pdf.methods[value] })),
)

async function createKey() {
    if (cfg.value?.commit.key && !confirm(s.value.commit.confirmRecreate)) return
    busy.value = true
    const next = await app.run(() => window.api.generateSigningKey())
    busy.value = false
    if (next) status.value = next
}
async function removeKey() {
    if (!confirm(s.value.commit.confirmRecreate)) return
    const next = await app.run(() => window.api.deleteSigningKey())
    if (next) status.value = next
}
async function copyPublic() {
    if (!cfg.value?.commit.key) return
    await navigator.clipboard.writeText(cfg.value.commit.key.publicKey)
    app.notify(s.value.commit.copied)
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
    const cert = await app.run(() => window.api.importPdfCert(p12File.value!, p12Password.value), s.value.pdf.imported)
    p12Password.value = ''
    if (cert) {
        p12File.value = null
        await refresh()
    }
}

const self = reactive({ name: app.settings?.author.name ?? '', org: '', email: app.settings?.author.email ?? '', years: 3 })
async function createSelf() {
    const cert = await app.run(() => window.api.createSelfSignedCert({ ...self }), s.value.pdf.created)
    if (cert) await refresh()
}
async function removeCert() {
    await app.run(() => window.api.removePdfCert())
    await refresh()
}
const exportCer = () => app.run(() => window.api.exportPdfCert())

const certRows = (c: CertInfo) => [
    [s.value.pdf.subject, c.subject + (c.email ? ` <${c.email}>` : '')],
    [s.value.pdf.issuer, c.selfSigned ? s.value.pdf.methods.self : c.issuer],
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
        <h3 class="cd-subhead">{{ s.commit.heading }}</h3>
        <SettingRow :label="s.commit.mode" :description="s.commit.modeDesc">
            <SegmentSwitch :model-value="cfg.commit.mode" :items="modeItems" @update:model-value="(v) => v && patch({ commit: { mode: v } })" />
        </SettingRow>
        <template v-if="cfg.commit.mode === 'app'">
            <SettingRow :label="s.commit.key" :description="s.commit.keyDesc">
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
            <USwitch :model-value="cfg.approvals.sign" :disabled="!cfg.commit.key" @update:model-value="(v: boolean) => patch({ approvals: { sign: v } })" />
        </SettingRow>
        <SettingRow v-if="cfg.commit.key && app.repoDir" :label="s.approvals.publish" :description="s.approvals.publishDesc">
            <UButton :label="s.approvals.publishButton" size="sm" color="neutral" variant="outline" @click="publishKey" />
        </SettingRow>

        <h3 class="cd-subhead">{{ s.pdf.heading }}</h3>
        <SettingRow :label="s.pdf.method" :description="s.pdf.methodDesc">
            <SegmentSwitch :model-value="cfg.pdf.method" :items="methodItems" @update:model-value="(v) => v && patch({ pdf: { method: v } }).then(refresh)" />
        </SettingRow>

        <template v-if="cfg.pdf.method === 'p12' || cfg.pdf.method === 'self'">
            <div v-if="cfg.pdf.cert && (cfg.pdf.method === 'self') === cfg.pdf.cert.selfSigned" class="cert">
                <dl>
                    <template v-for="[k, v] in certRows(cfg.pdf.cert)" :key="k">
                        <dt>{{ k }}</dt>
                        <dd>{{ v }}</dd>
                    </template>
                </dl>
                <div class="actions">
                    <UButton :label="s.pdf.exportCer" size="sm" color="neutral" variant="outline" icon="i-lucide-download" @click="exportCer" />
                    <UButton :label="s.pdf.removeCert" size="sm" color="error" variant="ghost" @click="removeCert" />
                </div>
                <p v-if="cfg.pdf.cert.selfSigned" class="cd-muted note">{{ s.pdf.selfNote }}</p>
            </div>
            <template v-else-if="cfg.pdf.method === 'p12'">
                <SettingRow :label="s.pdf.importP12">
                    <input ref="p12Input" type="file" accept=".p12,.pfx,application/x-pkcs12" hidden @change="onP12" />
                    <UButton :label="s.pdf.importP12" size="sm" color="neutral" variant="outline" icon="i-lucide-file-key" @click="pickP12" />
                </SettingRow>
                <SettingRow v-if="p12File" :label="s.pdf.password">
                    <UInput v-model="p12Password" type="password" autocomplete="off" class="cd-w-input" @keydown.enter="importP12" />
                    <UButton :label="s.pdf.importP12" size="sm" @click="importP12" />
                </SettingRow>
            </template>
            <template v-else>
                <SettingRow :label="s.pdf.selfName"><UInput v-model="self.name" class="cd-w-input" /></SettingRow>
                <SettingRow :label="s.pdf.selfOrg"><UInput v-model="self.org" class="cd-w-input" /></SettingRow>
                <SettingRow :label="s.pdf.selfEmail"><UInput v-model="self.email" type="email" class="cd-w-input" /></SettingRow>
                <SettingRow :label="s.pdf.selfYears" :description="s.pdf.selfNote">
                    <UInput v-model.number="self.years" type="number" min="1" max="10" class="cd-w-small" />
                    <UButton :label="s.pdf.createSelf" size="sm" :disabled="!self.name.trim()" @click="createSelf" />
                </SettingRow>
            </template>
        </template>

        <template v-if="cfg.pdf.method === 'myna'">
            <SettingRow :label="s.myna.status" :description="s.myna.disclosure">
                <span class="cd-muted">{{ mynaLine }}</span>
                <UButton :label="s.myna.refresh" size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refreshMyna" />
            </SettingRow>
        </template>

        <template v-if="cfg.pdf.method !== 'none'">
            <SettingRow :label="s.pdf.onExport">
                <USwitch :model-value="cfg.pdf.onExport" @update:model-value="(v: boolean) => patch({ pdf: { onExport: v } })" />
            </SettingRow>
            <SettingRow :label="s.pdf.onDeliver">
                <USwitch :model-value="cfg.pdf.onDeliver" @update:model-value="(v: boolean) => patch({ pdf: { onDeliver: v } })" />
            </SettingRow>
            <SettingRow :label="s.pdf.reason">
                <UInput
                    :model-value="cfg.pdf.reason"
                    class="cd-w-input"
                    @change="(e: Event) => patch({ pdf: { reason: (e.target as HTMLInputElement).value } })"
                />
            </SettingRow>
            <SettingRow :label="s.pdf.location">
                <UInput
                    :model-value="cfg.pdf.location"
                    class="cd-w-input"
                    @change="(e: Event) => patch({ pdf: { location: (e.target as HTMLInputElement).value } })"
                />
            </SettingRow>
            <SettingRow :label="s.pdf.contact">
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
            <SettingRow v-if="cfg.pdf.method !== 'myna'" :label="s.pdf.longTerm" :description="s.pdf.longTermDesc">
                <USwitch
                    :model-value="cfg.pdf.longTerm"
                    :disabled="!cfg.pdf.tsa.enabled"
                    @update:model-value="(v: boolean) => patch({ pdf: { longTerm: v } })"
                />
            </SettingRow>
        </template>

        <h3 class="cd-subhead">{{ s.seals.heading }}</h3>
        <p class="cd-muted note">{{ s.seals.desc }}</p>
        <div class="seals">
            <figure v-for="seal in seals" :key="seal.id" class="seal">
                <img v-if="sealUrls[seal.id]" :src="sealUrls[seal.id]" :alt="seal.label" />
                <figcaption>
                    <span>{{ seal.label || s.seals.kinds[seal.kind] }}</span>
                    <UButton icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost" :aria-label="s.seals.remove" @click="removeSeal(seal.id)" />
                </figcaption>
            </figure>
            <span v-if="!seals.length" class="cd-muted">{{ s.seals.empty }}</span>
        </div>
        <UButton :label="s.seals.create" size="sm" color="neutral" variant="outline" icon="i-lucide-stamp" class="self-start" @click="sealOpen = true" />
        <SealModal v-model:open="sealOpen" library @saved="loadSeals" />
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
    gap: 8px;
    margin-top: 10px;
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
