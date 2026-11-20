import { BrowserWindow, dialog, net, shell } from 'electron'
import { createServer, type Server } from 'node:http'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
    connectPasskeyViaPage,
    fromBase64,
    parseDocument,
    signDocument,
    signViaPage,
    toBase64,
    verifyDocument,
    type HandoffRequest,
    type SignResult,
    type TofuStore,
} from '@mdsig/core'
import { t } from '../shared/i18n'
import type { DeliveryRecord } from '../shared/api'
import { layout, locks, scanBody } from '../shared/mdsig-layout'
import {
    CDSIGN_EXT,
    DEFAULT_MD_SIGNING,
    isHttpsUrl,
    MAX_MD_KEYS,
    resolveMdKey,
    validSelector,
    validSigner,
    X_CLAUSEDOWN,
    type MdKeyEntry,
    type MdMethod,
    type MdRequirement,
    type MdSigningSettings,
    type MdVerifyReport,
    type AddMdKeyInput,
    type ExportCdsignInput,
    type ReceivedCdsign,
    type CdsignCheck,
    type MdSigningPatch,
    sameBody,
    requireLines,
} from '../shared/mdsig'
import { loadSettings, updateSettings } from './settings'
import { appKey } from './signing'
import { changedPaths, lastChange, readAt, safeJoin } from './git'
import { listDeliveries, recordReceived } from './workflow'
import { author, identity } from './git-base'

const fetchFn: typeof fetch = (input, init) => net.fetch(input as string, init)
const MAX_CDSIGN = 20 * 1024 * 1024
const HANDOFF_TIMEOUT = 5 * 60 * 1000

async function mdSettings(): Promise<MdSigningSettings> {
    return (await loadSettings()).signing?.md ?? DEFAULT_MD_SIGNING
}

function updateMd(fn: (md: MdSigningSettings) => MdSigningSettings): Promise<void> {
    return updateSettings((s) => ({ ...s, signing: { ...s.signing!, md: fn(s.signing?.md ?? DEFAULT_MD_SIGNING) } }))
}

const tofuStore: TofuStore = {
    get: async (signer) => (await mdSettings()).tofu[signer],
    set: (signer, pubkey) => updateMd((md) => ({ ...md, tofu: { ...md.tofu, [signer]: pubkey } })),
}

function resourceLoader(docDir?: string) {
    if (!docDir) return undefined
    const root = resolve(docDir)
    return async (ref: string): Promise<Uint8Array | null> => {
        const full = resolve(root, ref)
        if (full !== root && !full.startsWith(root + sep)) return null
        try {
            return new Uint8Array(await fsp.readFile(full))
        } catch {
            return null
        }
    }
}

export async function verifyMd(text: string, docDir?: string): Promise<MdVerifyReport> {
    const result = await verifyDocument(text, {
        fetch: fetchFn,
        tofuStore,
        confirmNewTofuKeys: true,
        checkRevocation: true,
        fetchResources: false,
        loadResource: resourceLoader(docDir),
    })
    const l = layout(text)
    return { result, findings: scanBody(text), layout: l, locks: locks(l) }
}

export async function verifyDocText(dir: string, path: string, text: string): Promise<MdVerifyReport> {
    return verifyMd(text, dirname(safeJoin(dir, path)))
}

export async function trustMdKey(signer: string, pubkey: string): Promise<void> {
    if (!signer || !/^[a-z0-9]+:[A-Za-z0-9+/=]+$/.test(pubkey)) throw new Error(t().mdsig.errors.badKey)
    await tofuStore.set(signer, pubkey)
}

function loopbackTransport(): { returnUrl: Promise<string>; transport: (req: HandoffRequest) => Promise<string>; close: () => void } {
    let server: Server | null = null
    let resolveAnswer: ((url: string) => void) | null = null
    const returnUrl = new Promise<string>((ok, ng) => {
        server = createServer((req, res) => {
            const url = `http://127.0.0.1${req.url ?? '/'}`
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
            res.end(`<!doctype html><meta charset="utf-8"><title>ClauseDown</title><p style="font:16px system-ui;margin:3em">${t().mdsig.handoff.back}</p>`)
            resolveAnswer?.(url)
        })
        server.on('error', ng)
        server.listen(0, '127.0.0.1', () => {
            const addr = server!.address()
            if (!addr || typeof addr === 'string') return ng(new Error('loopback'))
            ok(`http://127.0.0.1:${addr.port}/`)
        })
    })
    const transport = (req: HandoffRequest) =>
        new Promise<string>((ok, ng) => {
            const timer = setTimeout(() => ng(new Error(t().mdsig.errors.handoffTimeout)), HANDOFF_TIMEOUT)
            resolveAnswer = (url) => {
                const state = new URL(url).searchParams.get('state')
                if (state !== req.state) return
                clearTimeout(timer)
                resolveAnswer = null
                ok(url)
            }
            void shell.openExternal(req.url)
        })
    return { returnUrl, transport, close: () => server?.close() }
}

const newId = () =>
    randomBytes(9)
        .toString('base64url')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '0')
        .slice(0, 12)

function checkIdentity(method: MdMethod, signer: string, selector?: string) {
    if (!validSigner(method, signer)) throw new Error(t().mdsig.errors.badSigner)
    if (selector && (method !== 'dns' || !validSelector(selector))) throw new Error(t().mdsig.errors.badSelector)
}

async function appPublicKey(): Promise<Uint8Array> {
    const settings = await loadSettings()
    const info = settings.signing?.commit.key
    if (!info || info.storage === 'chip') throw new Error(t().mdsig.errors.noAppKey)
    const key = await appKey()
    if (!key) throw new Error(t().mdsig.errors.noAppKey)
    return new Uint8Array(key.blob.subarray(key.blob.length - 32))
}

export async function addMdKey(input: AddMdKeyInput): Promise<MdKeyEntry> {
    checkIdentity(input.method, input.signer, input.selector)
    const md = await mdSettings()
    if (md.keys.length >= MAX_MD_KEYS) throw new Error(t().mdsig.errors.tooManyKeys)
    const base = {
        id: newId(),
        label: input.label.slice(0, 80),
        method: input.method,
        signer: input.signer,
        ...(input.selector ? { selector: input.selector } : {}),
    }
    let entry: MdKeyEntry
    if (input.kind === 'app') entry = { ...base, kind: 'app', publicKey: `ed25519:${toBase64(await appPublicKey())}` }
    else {
        const page = input.page ?? md.pages[0]
        if (!page || !isHttpsUrl(page) || !md.pages.includes(page)) throw new Error(t().mdsig.errors.badPage)
        const lb = loopbackTransport()
        try {
            const pk = await connectPasskeyViaPage(page, { returnUrl: await lb.returnUrl, transport: lb.transport })
            entry = { ...base, kind: 'passkey', publicKey: `es256:${toBase64(pk.key)}`, credential: pk.credential, rpId: pk.rpId, page }
        } finally {
            lb.close()
        }
    }
    await updateMd((m) => ({ ...m, keys: [...m.keys, entry], defaultKey: m.defaultKey ?? entry.id }))
    return entry
}

export async function setMdSettings(patch: MdSigningPatch): Promise<void> {
    await updateMd((m) => {
        const next = { ...m }
        if (patch.defaultKey !== undefined) next.defaultKey = patch.defaultKey
        if (patch.role !== undefined) next.role = patch.role
        if (patch.reason !== undefined) next.reason = patch.reason
        if (patch.tsa !== undefined) next.tsa = patch.tsa
        if (patch.pages !== undefined) next.pages = patch.pages
        if (patch.repo) {
            const repoKeys = { ...m.repoKeys }
            if (patch.repo.key) repoKeys[patch.repo.dir] = patch.repo.key
            else delete repoKeys[patch.repo.dir]
            next.repoKeys = repoKeys
        }
        return next
    })
}

export async function removeMdKey(id: string): Promise<void> {
    await updateMd((m) => {
        const keys = m.keys.filter((k) => k.id !== id)
        return { ...m, keys, defaultKey: m.defaultKey === id ? keys[0]?.id : m.defaultKey }
    })
}

async function tsaUrl(md: MdSigningSettings): Promise<string | undefined> {
    if (!md.tsa) return undefined
    const pdf = (await loadSettings()).signing?.pdf
    if (!pdf || pdf.tsa.user) return undefined
    return pdf.tsa.url || undefined
}

export interface SignMdInput {
    keyId: string
    require?: (MdRequirement | string)[]
    extra?: Record<string, string>
    name?: string
}

export async function signMd(text: string, input: SignMdInput): Promise<SignResult> {
    const md = await mdSettings()
    const key = md.keys.find((k) => k.id === input.keyId)
    if (!key) throw new Error(t().mdsig.errors.noKey)
    const doc = parseDocument(text)
    if (!doc.chain.length && doc.strayMarker) throw new Error(t().mdsig.errors.contentAfter)
    const common = {
        method: key.method,
        signerId: key.signer,
        ...(key.selector ? { selector: key.selector } : {}),
        ...(md.role ? { role: md.role } : {}),
        ...(md.reason ? { reason: md.reason } : {}),
        ...(input.require?.length ? { require: input.require } : {}),
        ...(input.extra ? { extra: input.extra } : {}),
        tsaUrl: await tsaUrl(md),
        embedKey: key.method !== 'tofu',
        fetch: fetchFn,
    }
    if (key.kind === 'app') {
        const signer = await appKey()
        if (!signer || signer.storage === 'chip') throw new Error(t().mdsig.errors.noAppKey)
        const publicKey = new Uint8Array(signer.blob.subarray(signer.blob.length - 32))
        if (key.publicKey !== `ed25519:${toBase64(publicKey)}`) throw new Error(t().mdsig.errors.keyChanged)
        return signDocument(text, { ...common, signer: { alg: 'ed25519', publicKey, sign: async (d) => new Uint8Array(await signer.sign(d)) } })
    }
    const lb = loopbackTransport()
    try {
        return await signViaPage(text, {
            ...common,
            passkey: { page: key.page!, rpId: key.rpId!, key: fromBase64(key.publicKey!.slice('es256:'.length)), credential: key.credential! },
            returnUrl: await lb.returnUrl,
            transport: lb.transport,
            name: input.name,
        })
    } finally {
        lb.close()
    }
}

function safeName(s: string): string {
    let out = ''
    for (let i = 0; i < s.length; i++) out += s.charCodeAt(i) < 0x20 || '\\/:*?"<>|'.includes(s[i]) ? '_' : s[i]
    return out.trim() || 'document'
}

export async function exportCdsign(parent: BrowserWindow | null, input: ExportCdsignInput): Promise<string | null> {
    const md = await mdSettings()
    const key = input.keyId ? md.keys.find((k) => k.id === input.keyId) : resolveMdKey(md, input.dir)
    if (!key) throw new Error(t().mdsig.errors.noKey)
    let oid = input.oid
    if (!oid) {
        if ((await changedPaths(input.dir)).has(input.path)) throw new Error(t().mdsig.errors.unsaved)
        oid = (await lastChange(input.dir, input.path))?.oid
    }
    if (!oid) throw new Error(t().mdsig.errors.unsaved)
    const source = await readAt(input.dir, oid, input.path)
    if (source === null) throw new Error(t().mdsig.errors.noVersion)
    const signed = await signMd(source, {
        keyId: key.id,
        require: requireLines(input.require, !!input.sequential),
        extra: { [X_CLAUSEDOWN]: oid },
        name: input.title,
    })
    const opts = {
        defaultPath: `${safeName(input.title)}${t().mdsig.export.suffix}.${CDSIGN_EXT}`,
        filters: [{ name: t().mdsig.export.filter, extensions: [CDSIGN_EXT] }],
    }
    const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await fsp.writeFile(r.filePath, signed.text, 'utf8')
    await updateMd((m) => ({ ...m, lastRequire: input.require }))
    return r.filePath
}

async function checkCdsign(dir: string, delivery: DeliveryRecord, text: string, report: MdVerifyReport): Promise<CdsignCheck> {
    const first = report.result.signatures[0]
    const oid = first?.fields[X_CLAUSEDOWN]
    const doc = parseDocument(text)
    const source = oid && /^[0-9a-f]{40}$/.test(oid) ? await readAt(dir, oid, delivery.docPath).catch(() => null) : null
    const md = await mdSettings()
    return {
        oid,
        bodyMatches: source !== null && sameBody(doc.body, source),
        ownKey:
            !!first &&
            first.status === 'valid' &&
            md.keys.some((k) => k.publicKey === first.fields.pubkey && k.signer === first.fields.signer && k.method === first.fields.method),
        deliveryOid: !!oid && oid === delivery.oid,
    }
}

const picked = new Map<string, string>()

export async function pickCdsign(parent: BrowserWindow | null, dir: string, deliveryId: string): Promise<ReceivedCdsign | null> {
    const delivery = (await listDeliveries(dir)).find((d) => d.id === deliveryId)
    if (!delivery) return null
    const opts = { properties: ['openFile'] as 'openFile'[], filters: [{ name: t().mdsig.export.filter, extensions: [CDSIGN_EXT, 'md'] }] }
    const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    if ((await fsp.stat(path)).size > MAX_CDSIGN) throw new Error(t().mdsig.errors.tooLarge)
    const text = await fsp.readFile(path, 'utf8')
    picked.set(path, text)
    const report = await verifyMd(text)
    return { path, name: basename(path), report, check: await checkCdsign(dir, delivery, text, report) }
}

function freePath(folder: string, source: string): string {
    const base = `${basename(source).replace(/\.(cdsign|md)$/i, '')}${t().signing.received.suffix}`
    let out = join(folder, `${base}.${CDSIGN_EXT}`)
    for (let i = 2; existsSync(out); i++) out = join(folder, `${base} (${i}).${CDSIGN_EXT}`)
    return out
}

export async function saveCdsign(parent: BrowserWindow | null, input: { path: string; dir: string; deliveryId: string }): Promise<string | null> {
    const text = picked.get(input.path)
    if (text === undefined) throw new Error(t().signing.received.notPicked)
    const delivery = (await listDeliveries(input.dir)).find((d) => d.id === input.deliveryId)
    if (!delivery) return null
    const report = await verifyMd(text)
    const check = await checkCdsign(input.dir, delivery, text, report)
    if (!check.bodyMatches) throw new Error(t().mdsig.errors.bodyMismatch)
    let out: string | null = null
    if (delivery.folder && existsSync(delivery.folder)) out = freePath(delivery.folder, input.path)
    else {
        const opts = { defaultPath: freePath(dirname(input.path), input.path), filters: [{ name: t().mdsig.export.filter, extensions: [CDSIGN_EXT] }] }
        const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
        out = r.canceled || !r.filePath ? null : r.filePath
    }
    if (!out) return null
    await fsp.writeFile(out, text, 'utf8')
    picked.delete(input.path)
    const me = (await identity(input.dir).catch(() => null))?.name ?? (await author(input.dir)).name
    await recordReceived(input.dir, delivery.id, {
        file: basename(out),
        at: new Date().toISOString(),
        by: me,
        signers: report.result.signatures.filter((s) => s.fields.method !== 'tsa').map((s) => `${s.fields.method}:${s.fields.signer}`),
        kind: 'cdsign',
        agreement: report.result.ok ? report.result.agreement.status : 'invalid',
    })
    return out
}
