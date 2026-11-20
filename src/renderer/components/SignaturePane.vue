<script setup lang="ts">
import type { BlockResult } from '@mdsig/core'
import { overallStatus, type MdVerifyReport } from '@shared/mdsig'
import { FINDING_ORDER, type Finding, type FindingKind } from '@shared/mdsig-layout'
import { useStoredRef } from '~/composables/useStoredRef'
import { useT } from '~/composables/useT'

const props = defineProps<{ report: MdVerifyReport | null; busy: boolean; embedded?: boolean }>()
const emit = defineEmits<{ line: [number]; trust: [string, string]; recheck: []; close: [] }>()
const t = useT()
const p = computed(() => t.value.mdsig.pane)

const MIN = 80
const MAX = 600
const height = useStoredRef('clausedown.pane.signatures', 220, { delay: 300 })
let startY = 0
let startH = 0
const dragging = ref(false)
function down(e: PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    startY = e.clientY
    startH = height.value
    dragging.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.body.classList.add('cd-resizing-v')
}
function move(e: PointerEvent) {
    if (dragging.value) height.value = Math.round(Math.min(MAX, Math.max(MIN, startH - (e.clientY - startY))))
}
function up() {
    dragging.value = false
    document.body.classList.remove('cd-resizing-v')
}
onBeforeUnmount(up)

const overall = computed(() => overallStatus(props.report))
const OVERALL_ICON = {
    none: 'i-lucide-pen-off',
    verified: 'i-lucide-shield-check',
    pending: 'i-lucide-shield-ellipsis',
    unresolved: 'i-lucide-shield-question',
    failed: 'i-lucide-shield-x',
}
const STATUS_ICON: Record<BlockResult['status'], string> = {
    valid: 'i-lucide-circle-check',
    invalid: 'i-lucide-circle-x',
    malformed: 'i-lucide-circle-x',
    unsupported: 'i-lucide-circle-x',
    unresolved: 'i-lucide-circle-help',
}

const who = (r: { method: string; signer: string; role?: string }) => `${r.method}:${r.signer}${r.role ? ` ${r.role}` : ''}`

function details(s: BlockResult): string[] {
    const f = s.fields
    const out: string[] = []
    if (f.ts) out.push(p.value.ts(f.ts))
    if (s.webauthn?.rpId ?? f.rp_id) out.push(p.value.rpId(s.webauthn?.rpId ?? f.rp_id!))
    if (s.partial) out.push(p.value.partial(s.partial.sections.join(', ')))
    if (s.tsa) {
        if (s.tsa.status === 'ok' && s.tsa.verified && s.tsa.genTime) out.push(p.value.tsaOk(s.tsa.genTime))
        else if (s.tsa.status === 'ok') out.push(p.value.tsaUnchecked)
        else out.push(p.value.tsaBad(s.tsa.detail))
    }
    if (s.revocation?.status === 'not-checked' && f.revocation_url) out.push(p.value.revocationUnchecked)
    if (s.resources?.some((r) => r.status === 'not-checked')) out.push(p.value.remoteUnchecked)
    if (s.tofu?.status === 'known') out.push(p.value.tofuKnown)
    return out
}

const findings = computed(() => {
    const all = props.report?.findings ?? []
    return FINDING_ORDER.map((k) => [k, all.filter((f) => f.kind === k)] as [FindingKind, Finding[]]).filter(([, l]) => l.length)
})
</script>

<template>
    <section class="sigs" :class="{ embedded }" :style="embedded ? undefined : { height: `${height}px` }">
        <div
            v-if="!embedded"
            class="grip"
            :class="{ dragging }"
            role="separator"
            aria-orientation="horizontal"
            :aria-label="p.resize"
            @pointerdown="down"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
            @dblclick="height = 220"
        />
        <div class="cd-pane-bar">
            <span class="cd-pane-title">{{ p.title }}</span>
            <span class="overall" :class="overall">
                <UIcon :name="busy ? 'i-lucide-loader-circle' : OVERALL_ICON[overall]" :class="{ spin: busy }" />{{
                    busy ? t.mdsig.status.checking : p.overall[overall]
                }}
            </span>
            <span class="grow" />
            <UTooltip v-if="!embedded" :text="p.recheck">
                <UButton
                    icon="i-lucide-refresh-cw"
                    size="xs"
                    square
                    color="neutral"
                    variant="ghost"
                    :aria-label="p.recheck"
                    :disabled="busy"
                    @click="emit('recheck')"
                />
            </UTooltip>
            <UTooltip v-if="!embedded" :text="p.close">
                <UButton icon="i-lucide-panel-bottom-close" size="xs" square color="neutral" variant="ghost" :aria-label="p.close" @click="emit('close')" />
            </UTooltip>
        </div>
        <div class="list">
            <p v-if="!report || (!report.result.signatures.length && !report.result.error)" class="empty">{{ p.empty }}</p>
            <template v-else>
                <p v-if="report.result.error" class="row-note bad">{{ report.result.error }}</p>
                <button v-for="s in report.result.signatures" :key="s.index" class="row" :class="s.status" @click="emit('line', s.line)">
                    <UIcon :name="STATUS_ICON[s.status]" class="mark" />
                    <span class="main">
                        <span class="head">
                            <b>{{ s.fields.method === 'tsa' ? p.tsaBlock : `${s.fields.method}:${s.fields.signer}` }}</b>
                            <span v-if="s.fields.role" class="role">{{ s.fields.role }}</span>
                            <span class="state">{{ p.statuses[s.status] }}<template v-if="s.code">（{{ p.codes[s.code] ?? s.code }}）</template></span>
                        </span>
                        <span v-for="d in details(s)" :key="d" class="sub">{{ d }}</span>
                        <span v-if="s.message && s.status !== 'valid'" class="sub msg">{{ s.message }}</span>
                        <span v-if="s.tofu?.status === 'new'" class="sub tofu">
                            {{ p.tofuNew(s.tofu.fingerprint) }}
                            <UButton size="xs" variant="soft" :label="p.trust" @click.stop="emit('trust', s.fields.signer!, s.fields.pubkey!)" />
                        </span>
                    </span>
                    <span class="where">{{ p.block(s.index) }}</span>
                </button>
                <div class="agree" :class="report.result.agreement.status">
                    <span class="label">{{ p.agreement.title }}</span>
                    <span>{{ p.agreement[report.result.agreement.status] }}</span>
                    <ul v-if="report.result.agreement.missing.length">
                        <li v-for="(m, i) in report.result.agreement.missing" :key="i">
                            {{ p.agreement.step(m.step) }}　{{ p.agreement.missing(who(m), m.need) }}
                        </li>
                    </ul>
                    <ul v-if="report.result.agreement.violations.length">
                        <li v-for="(v, i) in report.result.agreement.violations" :key="i">{{ p.agreement.violation(who(v)) }}</li>
                    </ul>
                </div>
            </template>
            <div v-if="findings.length" class="findings">
                <span class="label">{{ p.findings.title }}</span>
                <span class="note">{{ p.findings.note }}</span>
                <template v-for="[kind, list] in findings" :key="kind">
                    <span class="kind">{{ p.findings.kinds[kind] }}（{{ list.length }}）</span>
                    <button v-for="(f, i) in list" :key="`${kind}${i}`" class="finding" @click="emit('line', f.line)">
                        <span class="text">{{ f.text }}</span>
                        <span class="where">{{ p.line(f.line) }}</span>
                    </button>
                </template>
            </div>
        </div>
    </section>
</template>

<style scoped>
.sigs {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
    border-top: 1px solid var(--ui-border);
    background: var(--cd-sidebar);
}

.sigs.embedded {
    max-height: 340px;
    border-top: 0;
}

.grip {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    z-index: 2;
    cursor: row-resize;
}

.grip:hover,
.grip.dragging {
    background: color-mix(in oklab, var(--ui-color-primary-500) 40%, transparent);
}

.grow {
    flex: 1;
}

.overall {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.overall.verified {
    color: var(--ui-success);
}

.overall.pending,
.overall.unresolved {
    color: var(--ui-warning);
}

.overall.failed {
    color: var(--ui-error);
}

.spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 8px;
    font-size: 12px;
}

.row,
.finding {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 4px 12px;
    text-align: left;
    color: var(--ui-text);
}

.row:hover,
.finding:hover {
    background: var(--ui-bg-elevated);
}

.mark {
    flex: none;
    position: relative;
    top: 2px;
}

.row.valid .mark {
    color: var(--ui-success);
}

.row.unresolved .mark {
    color: var(--ui-warning);
}

.row.invalid .mark,
.row.malformed .mark,
.row.unsupported .mark {
    color: var(--ui-error);
}

.main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
}

.head b {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.role,
.state,
.sub,
.where,
.note {
    color: var(--ui-text-muted);
}

.where {
    flex: none;
    font-size: 11px;
}

.tofu {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ui-warning);
}

.agree,
.findings {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 6px 12px 0;
    padding-top: 6px;
    border-top: 1px solid var(--ui-border);
}

.agree.complete {
    color: var(--ui-success);
}

.agree.pending {
    color: var(--ui-warning);
}

.agree.violated {
    color: var(--ui-error);
}

.agree ul {
    margin: 2px 0 0 1.2em;
    list-style: disc;
    color: var(--ui-text);
}

.label {
    font-weight: 600;
    color: var(--ui-text);
}

.kind {
    margin-top: 6px;
    font-weight: 600;
}

.finding {
    padding-left: 0;
    padding-right: 0;
}

.finding .text {
    flex: 1;
    min-width: 0;
    font-family: var(--cd-mono, ui-monospace, monospace);
    overflow-wrap: anywhere;
}

.empty,
.row-note {
    margin: 0;
    padding: 6px 12px;
    color: var(--ui-text-muted);
}

.row-note.bad {
    color: var(--ui-error);
}
</style>
