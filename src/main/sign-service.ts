import { BrowserWindow, dialog, net } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { HttpTimestampAuthority, type Signer } from '@libpdf/core'
import { t } from '../shared/i18n'
import { randomBytes } from 'node:crypto'
import {
    CERT_ID_RE,
    cleanSigning,
    DEFAULT_SIGNING,
    LEGACY_CERT_ID,
    MAX_PDF_CERTS,
    resolveCert,
    TSA_PRESETS,
    type PdfCertEntry,
    type SigningSettings,
} from '../shared/signing'
import type { DeepPartial, ReceivedPdf, ReceivedPdfInput, SigningStatus } from '../shared/api'
import { loadSecret, saveSecret, updateSettings } from './settings'
import { certSummary, checkTsaUrl, createSelfSigned, keySigner, listSignatures, p12Signer, signPdf, TsaError, type Tsa } from './pdf-sign'
import { listDeliveries, recordReceived } from './workflow'
import { author, identity } from './git-base'
import { appKey, externalConfig, signingSettings } from './signing'
import { chipAvailable } from './keychip'
import { mynaAvailable, openMynaSigner } from './myna'

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch as T) ?? base
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(patch)) {
        const cur = out[k]
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? merge(cur, v as DeepPartial<typeof cur>) : v
    }
    return out as T
}

async function saveSigning(fn: (s: SigningSettings) => SigningSettings): Promise<SigningSettings> {
    let next = DEFAULT_SIGNING
    await updateSettings((s) => {
        next = cleanSigning(fn(s.signing ?? structuredClone(DEFAULT_SIGNING)))
        return { ...s, signing: next }
    })
    return next
}

export async function signingStatus(dir?: string): Promise<SigningStatus> {
    const signing = await signingSettings()
    return {
        signing,
        hasKey: !!signing.commit.key && !!(await appKey().catch(() => null)),
        external: await externalConfig(dir).catch(() => null),
        myna: await mynaAvailable(),
        chip: await chipAvailable(),
        hasTsaPassword: !!(await loadSecret('sign-tsa-pass')),
    }
}

export async function setSigningPrefs(patch: DeepPartial<SigningSettings>): Promise<SigningSettings> {
    const safe = { ...patch } as DeepPartial<SigningSettings>
    if (safe.commit) delete safe.commit.key
    if (safe.commit) delete safe.commit.registered
    if (safe.pdf) {
        delete safe.pdf.certs
        delete safe.pdf.defaultCert
        delete safe.pdf.repoCerts
    }
    if (safe.pdf?.tsa?.url) checkTsaUrl(safe.pdf.tsa.url)
    return saveSigning((s) => merge(s, safe))
}

export async function setTsaPassword(password: string): Promise<void> {
    await saveSecret('sign-tsa-pass', String(password ?? ''))
}

function newCertId(): string {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
    return [...randomBytes(12)].map((x) => a[x % a.length]).join('')
}

type CertSecret = 'p12' | 'pass' | 'key'
const LEGACY_SECRET = { p12: 'sign-pdf-p12', pass: 'sign-pdf-pass', key: 'sign-pdf-key' } as const

async function certSecret(id: string, kind: CertSecret): Promise<string | null> {
    if (!CERT_ID_RE.test(id)) return null
    const value = await loadSecret(`sign-pdf-${kind}-${id}`)
    if (value || !Object.values(LEGACY_CERT_ID).includes(id)) return value
    const old = await loadSecret(LEGACY_SECRET[kind])
    if (old) {
        await saveSecret(`sign-pdf-${kind}-${id}`, old)
        await saveSecret(LEGACY_SECRET[kind], '')
    }
    return old
}

async function dropCertSecrets(id: string): Promise<void> {
    if (!CERT_ID_RE.test(id)) return
    await Promise.all((['p12', 'pass', 'key'] as const).map((k) => saveSecret(`sign-pdf-${k}-${id}`, '')))
}

async function assertRoom(kind: PdfCertEntry['kind']): Promise<void> {
    const s = await signingSettings()
    if (s.pdf.certs.length >= MAX_PDF_CERTS) throw new Error(t().signing.errors.tooManyCerts(MAX_PDF_CERTS))
    if (kind === 'myna' && s.pdf.certs.some((c) => c.kind === 'myna')) throw new Error(t().signing.errors.mynaExists)
}

async function addCert(entry: PdfCertEntry): Promise<PdfCertEntry> {
    await saveSigning((s) => ({ ...s, pdf: { ...s.pdf, certs: [...s.pdf.certs, entry], defaultCert: s.pdf.defaultCert ?? entry.id } }))
    return entry
}

const labelOf = (label: unknown, fallback: string) => (typeof label === 'string' ? label.trim().slice(0, 80) : '') || fallback

export async function importPdfCert(data: Uint8Array, password: string, label?: string): Promise<PdfCertEntry> {
    await assertRoom('p12')
    const bytes = new Uint8Array(data)
    const signer = await p12Signer(bytes, String(password ?? ''))
    const cert = await certSummary(signer.certificate)
    const id = newCertId()
    await saveSecret(`sign-pdf-p12-${id}`, Buffer.from(bytes).toString('base64'))
    await saveSecret(`sign-pdf-pass-${id}`, String(password ?? ''))
    return addCert({ id, label: labelOf(label, cert.subject), kind: 'p12', cert })
}

export async function createSelfSignedCert(opts: { name: string; email?: string; org?: string; years?: number; label?: string }): Promise<PdfCertEntry> {
    await assertRoom('self')
    const years = Math.min(10, Math.max(1, Math.round(Number(opts?.years) || 3)))
    const made = await createSelfSigned({ name: String(opts?.name ?? ''), email: opts?.email, org: opts?.org, years })
    const cert = await certSummary(made.cert)
    const id = newCertId()
    await saveSecret(`sign-pdf-key-${id}`, Buffer.from(made.key).toString('base64'))
    return addCert({ id, label: labelOf(opts?.label, cert.subject), kind: 'self', cert, selfCert: Buffer.from(made.cert).toString('base64') })
}

export async function addMynaCert(label?: string): Promise<PdfCertEntry> {
    if (!(await mynaAvailable())) throw new Error(t().signing.errors.mynaMissing)
    await assertRoom('myna')
    return addCert({ id: newCertId(), label: labelOf(label, t().signing.pdf.mynaLabel), kind: 'myna' })
}

export async function updatePdfCert(id: string, patch: Pick<PdfCertEntry, 'label' | 'reason' | 'location' | 'contactInfo'>): Promise<SigningSettings> {
    const pick = (v: unknown) => (typeof v === 'string' ? v : undefined)
    return saveSigning((s) => ({
        ...s,
        pdf: {
            ...s.pdf,
            certs: s.pdf.certs.map((c) =>
                c.id !== id
                    ? c
                    : {
                          ...c,
                          label: pick(patch?.label) ?? c.label,
                          reason: pick(patch?.reason) ?? c.reason,
                          location: pick(patch?.location) ?? c.location,
                          contactInfo: pick(patch?.contactInfo) ?? c.contactInfo,
                      },
            ),
        },
    }))
}

export async function removePdfCert(id: string): Promise<SigningSettings> {
    await dropCertSecrets(id)
    return saveSigning((s) => ({
        ...s,
        pdf: { ...s.pdf, certs: s.pdf.certs.filter((c) => c.id !== id), defaultCert: s.pdf.defaultCert === id ? undefined : s.pdf.defaultCert },
    }))
}

export async function setDefaultPdfCert(id: string): Promise<SigningSettings> {
    return saveSigning((s) => ({ ...s, pdf: { ...s.pdf, defaultCert: id } }))
}

export async function setRepoPdfCert(dir: string, id: string | null): Promise<SigningSettings> {
    return saveSigning((s) => {
        const repoCerts = { ...s.pdf.repoCerts }
        if (id) repoCerts[dir] = id
        else delete repoCerts[dir]
        return { ...s, pdf: { ...s.pdf, repoCerts } }
    })
}

function certById(s: SigningSettings, id: string): PdfCertEntry {
    const c = s.pdf.certs.find((x) => x.id === id)
    if (!c) throw new Error(t().signing.errors.noCert)
    return c
}

async function storedP12(id: string): Promise<Signer | null> {
    const p12 = await certSecret(id, 'p12')
    if (!p12) return null
    return p12Signer(new Uint8Array(Buffer.from(p12, 'base64')), (await certSecret(id, 'pass')) ?? '')
}

async function certDer(c: PdfCertEntry): Promise<Uint8Array | null> {
    if (c.kind === 'self' && c.selfCert) return new Uint8Array(Buffer.from(c.selfCert, 'base64'))
    if (c.kind === 'p12') return (await storedP12(c.id))?.certificate ?? null
    return null
}

export async function exportPdfCert(parent: BrowserWindow | null, id: string): Promise<string | null> {
    const der = await certDer(certById(await signingSettings(), id))
    if (!der) throw new Error(t().signing.errors.noCert)
    const opts = { defaultPath: 'certificate.cer', filters: [{ name: t().signing.certFile, extensions: ['cer'] }] }
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await fsp.writeFile(r.filePath, der)
    return r.filePath
}

async function tsaOf(s: SigningSettings): Promise<Tsa | undefined> {
    if (!s.pdf.tsa.enabled) return undefined
    const preset = TSA_PRESETS.find((p) => p.id === s.pdf.tsa.preset)
    const url = s.pdf.tsa.url || preset?.url || ''
    const headers: Record<string, string> = {}
    const pass = await loadSecret('sign-tsa-pass')
    if (s.pdf.tsa.user && pass) headers.Authorization = `Basic ${Buffer.from(`${s.pdf.tsa.user}:${pass}`).toString('base64')}`
    return { url: checkTsaUrl(url), headers, fetch: ((input, init) => net.fetch(input as string, init)) as typeof globalThis.fetch }
}

export async function testTimestamp(): Promise<{ ok: true }> {
    const s = await signingSettings()
    const tsa = await tsaOf({ ...s, pdf: { ...s.pdf, tsa: { ...s.pdf.tsa, enabled: true } } })
    if (!tsa) throw new Error(t().signing.errors.tsaUrl)
    const authority = new HttpTimestampAuthority(tsa.url, { headers: tsa.headers, fetch: tsa.fetch, timeout: 15_000 })
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`clausedown ${Date.now()}`)))
    try {
        await authority.timestamp(digest, 'SHA-256')
    } catch (e) {
        throw new Error(t().signing.errors.tsa((e as Error).message))
    }
    return { ok: true }
}

async function signerFor(c: PdfCertEntry, pin?: string): Promise<{ signer: Signer; close?: () => Promise<void> }> {
    if (c.kind === 'p12') {
        const signer = await storedP12(c.id)
        if (signer) return { signer }
    }
    if (c.kind === 'self' && c.selfCert) {
        const key = await certSecret(c.id, 'key')
        if (key) return { signer: await keySigner(new Uint8Array(Buffer.from(key, 'base64')), new Uint8Array(Buffer.from(c.selfCert, 'base64'))) }
    }
    if (c.kind === 'myna') return openMynaSigner(pin ?? '')
    throw new Error(t().signing.errors.noCert)
}

export async function pdfSigningReady(): Promise<boolean> {
    return (await signingSettings()).pdf.certs.length > 0
}

export interface SignSession {
    sign(bytes: Uint8Array): Promise<Uint8Array>
    close(): Promise<void>
}

export interface SignOptions {
    certId?: string
    pin?: string
    dir?: string
}

export async function openSignSession(parent: BrowserWindow | null, o: SignOptions = {}): Promise<SignSession> {
    const s = await signingSettings()
    const cert = o.certId ? certById(s, o.certId) : resolveCert(s.pdf, o.dir)
    if (!cert) throw new Error(t().signing.errors.noCert)
    const { signer, close } = await signerFor(cert, o.pin)
    const tsa = await tsaOf(s)
    const opts = {
        signer,
        reason: cert.reason || s.pdf.reason,
        location: cert.location || s.pdf.location,
        contactInfo: cert.contactInfo || s.pdf.contactInfo,
        longTerm: cert.kind !== 'myna' && s.pdf.longTerm,
    }
    let useTsa = tsa
    return {
        sign: async (bytes) => {
            try {
                return await signPdf(bytes, { ...opts, tsa: useTsa })
            } catch (e) {
                if (!(e instanceof TsaError) || !(await askWithoutTsa(parent, e))) throw e
                useTsa = undefined
                return signPdf(bytes, opts)
            }
        },
        close: async () => {
            await close?.()
        },
    }
}

async function askWithoutTsa(parent: BrowserWindow | null, e: Error): Promise<boolean> {
    const box = {
        type: 'warning' as const,
        message: e.message,
        detail: t().signing.tsaFallback,
        buttons: [t().signing.signWithoutTsa, t().common.cancel],
        defaultId: 1,
        cancelId: 1,
    }
    const r = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box)
    return r.response === 0
}

const MAX_PDF = 100 * 1024 * 1024
const picked = new Set<string>()

export async function pickReceivedPdf(parent: BrowserWindow | null): Promise<ReceivedPdf | null> {
    const opts = { properties: ['openFile'] as 'openFile'[], filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    const stat = await fsp.stat(path)
    if (stat.size > MAX_PDF) throw new Error(t().signing.received.tooLarge)
    const bytes = new Uint8Array(await fsp.readFile(path))
    picked.add(path)
    return { path, name: basename(path), signatures: listSignatures(bytes) }
}

function freePath(folder: string, source: string): string {
    const base = `${basename(source).replace(/\.pdf$/i, '')}${t().signing.received.suffix}`
    let out = join(folder, `${base}.pdf`)
    for (let i = 2; existsSync(out); i++) out = join(folder, `${base} (${i}).pdf`)
    return out
}

export async function saveReceivedPdf(parent: BrowserWindow | null, input: ReceivedPdfInput): Promise<string | null> {
    if (!picked.has(input.path)) throw new Error(t().signing.received.notPicked)
    const delivery = (await listDeliveries(input.dir)).find((d) => d.id === input.deliveryId)
    if (!delivery) return null
    const bytes = new Uint8Array(await fsp.readFile(input.path))
    let out: string | null = null
    if (delivery.folder && existsSync(delivery.folder)) out = freePath(delivery.folder, input.path)
    else {
        const opts = { defaultPath: freePath(dirname(input.path), input.path), filters: [{ name: 'PDF', extensions: ['pdf'] }] }
        const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
        out = r.canceled || !r.filePath ? null : r.filePath
    }
    if (!out) return null
    await fsp.writeFile(out, bytes)
    picked.delete(input.path)
    const me = (await identity(input.dir).catch(() => null))?.name ?? (await author(input.dir)).name
    const entry = { file: basename(out), at: new Date().toISOString(), by: me, signers: listSignatures(bytes).map((s) => s.signer) }
    await recordReceived(input.dir, delivery.id, entry)
    return out
}
