import { BrowserWindow, dialog, net } from 'electron'
import { promises as fsp } from 'node:fs'
import { HttpTimestampAuthority, type Signer } from '@libpdf/core'
import { t } from '../shared/i18n'
import { cleanSigning, DEFAULT_SIGNING, TSA_PRESETS, type CertInfo, type SigningSettings } from '../shared/signing'
import type { DeepPartial, SigningStatus } from '../shared/api'
import { loadSecret, saveSecret, updateSettings } from './settings'
import { certSummary, checkTsaUrl, createSelfSigned, keySigner, p12Signer, signPdf, TsaError, type Tsa } from './pdf-sign'
import { appKey, externalConfig, signingSettings } from './signing'
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
        hasTsaPassword: !!(await loadSecret('sign-tsa-pass')),
    }
}

export async function setSigningPrefs(patch: DeepPartial<SigningSettings>): Promise<SigningSettings> {
    const safe = { ...patch } as DeepPartial<SigningSettings>
    if (safe.commit) delete safe.commit.key
    if (safe.commit) delete safe.commit.registered
    if (safe.pdf) {
        delete safe.pdf.cert
        delete safe.pdf.selfCert
    }
    if (safe.pdf?.tsa?.url) checkTsaUrl(safe.pdf.tsa.url)
    return saveSigning((s) => merge(s, safe))
}

export async function setTsaPassword(password: string): Promise<void> {
    await saveSecret('sign-tsa-pass', String(password ?? ''))
}

export async function importPdfCert(data: Uint8Array, password: string): Promise<CertInfo> {
    const bytes = new Uint8Array(data)
    const signer = await p12Signer(bytes, String(password ?? ''))
    const cert = await certSummary(signer.certificate)
    await saveSecret('sign-pdf-p12', Buffer.from(bytes).toString('base64'))
    await saveSecret('sign-pdf-pass', String(password ?? ''))
    await saveSigning((s) => ({ ...s, pdf: { ...s.pdf, method: 'p12', cert } }))
    return cert
}

export async function createSelfSignedCert(opts: { name: string; email?: string; org?: string; years?: number }): Promise<CertInfo> {
    const years = Math.min(10, Math.max(1, Math.round(Number(opts?.years) || 3)))
    const made = await createSelfSigned({ name: String(opts?.name ?? ''), email: opts?.email, org: opts?.org, years })
    const cert = await certSummary(made.cert)
    await saveSecret('sign-pdf-key', Buffer.from(made.key).toString('base64'))
    await saveSigning((s) => ({ ...s, pdf: { ...s.pdf, method: 'self', cert, selfCert: Buffer.from(made.cert).toString('base64') } }))
    return cert
}

export async function removePdfCert(): Promise<void> {
    await Promise.all([saveSecret('sign-pdf-p12', ''), saveSecret('sign-pdf-pass', ''), saveSecret('sign-pdf-key', '')])
    await saveSigning((s) => ({ ...s, pdf: { ...s.pdf, method: s.pdf.method === 'myna' ? 'myna' : 'none', cert: undefined, selfCert: undefined } }))
}

async function certDer(s: SigningSettings): Promise<Uint8Array | null> {
    if (s.pdf.method === 'self' && s.pdf.selfCert) return new Uint8Array(Buffer.from(s.pdf.selfCert, 'base64'))
    if (s.pdf.method === 'p12') {
        const signer = await storedP12()
        return signer?.certificate ?? null
    }
    return null
}

async function storedP12(): Promise<Signer | null> {
    const p12 = await loadSecret('sign-pdf-p12')
    if (!p12) return null
    return p12Signer(new Uint8Array(Buffer.from(p12, 'base64')), (await loadSecret('sign-pdf-pass')) ?? '')
}

export async function exportPdfCert(parent: BrowserWindow | null): Promise<string | null> {
    const der = await certDer(await signingSettings())
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

async function currentSigner(s: SigningSettings, pin?: string): Promise<{ signer: Signer; close?: () => Promise<void> }> {
    if (s.pdf.method === 'p12') {
        const signer = await storedP12()
        if (signer) return { signer }
    }
    if (s.pdf.method === 'self' && s.pdf.selfCert) {
        const key = await loadSecret('sign-pdf-key')
        if (key) return { signer: await keySigner(new Uint8Array(Buffer.from(key, 'base64')), new Uint8Array(Buffer.from(s.pdf.selfCert, 'base64'))) }
    }
    if (s.pdf.method === 'myna') return openMynaSigner(pin ?? '')
    throw new Error(t().signing.errors.noCert)
}

export async function pdfSigningReady(): Promise<boolean> {
    const s = await signingSettings()
    return s.pdf.method !== 'none'
}

export interface SignSession {
    sign(bytes: Uint8Array): Promise<Uint8Array>
    close(): Promise<void>
}

export async function openSignSession(parent: BrowserWindow | null, pin?: string): Promise<SignSession> {
    const s = await signingSettings()
    const { signer, close } = await currentSigner(s, pin)
    const tsa = await tsaOf(s)
    const opts = { signer, reason: s.pdf.reason, location: s.pdf.location, contactInfo: s.pdf.contactInfo, longTerm: s.pdf.method !== 'myna' && s.pdf.longTerm }
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
