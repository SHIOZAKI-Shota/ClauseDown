import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { CryptoKeySigner, HttpTimestampAuthority, P12Signer, PDF, TimestampError, type Signer } from '@libpdf/core'
import { t } from '../shared/i18n'

const subtle = () => globalThis.crypto.subtle
const own = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u)

const OID = {
    commonName: '2.5.4.3',
    organization: '2.5.4.10',
    email: '1.2.840.113549.1.9.1',
    basicConstraints: '2.5.29.19',
    keyUsage: '2.5.29.15',
    extKeyUsage: '2.5.29.37',
    subjectKeyId: '2.5.29.14',
    emailProtection: '1.3.6.1.5.5.7.3.4',
    documentSigning: '1.3.6.1.4.1.311.10.3.12',
}

export interface CertSummary {
    subject: string
    issuer: string
    email: string
    notBefore: string
    notAfter: string
    selfSigned: boolean
    fingerprint: string
}

export interface SelfSigned {
    key: Uint8Array
    cert: Uint8Array
}

export class TsaError extends Error {}

const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')

function parseCert(der: Uint8Array): pkijs.Certificate {
    const asn = asn1js.fromBER(der)
    if (asn.offset === -1) throw new Error(t().signing.errors.badPassword)
    return new pkijs.Certificate({ schema: asn.result })
}

function nameOf(rdn: pkijs.RelativeDistinguishedNames, oid: string): string {
    const hit = rdn.typesAndValues.find((v) => v.type === oid)
    const v = hit ? (hit.value.valueBlock as { value?: unknown }).value : undefined
    return typeof v === 'string' ? v : ''
}

function displayName(rdn: pkijs.RelativeDistinguishedNames): string {
    return [nameOf(rdn, OID.commonName), nameOf(rdn, OID.organization)].filter(Boolean).join(' / ')
}

export async function certSummary(der: Uint8Array): Promise<CertSummary> {
    const c = parseCert(der)
    const digest = await subtle().digest('SHA-256', own(der))
    return {
        subject: displayName(c.subject),
        issuer: displayName(c.issuer),
        email: nameOf(c.subject, OID.email),
        notBefore: c.notBefore.value.toISOString(),
        notAfter: c.notAfter.value.toISOString(),
        selfSigned: c.subject.isEqual(c.issuer),
        fingerprint: hex(digest),
    }
}

export function assertValid(summary: CertSummary, now = new Date()): void {
    if (now < new Date(summary.notBefore)) throw new Error(t().signing.errors.notYet(summary.notBefore.slice(0, 10)))
    if (now > new Date(summary.notAfter)) throw new Error(t().signing.errors.expired(summary.notAfter.slice(0, 10)))
}

function rdn(entries: [string, string][]): pkijs.RelativeDistinguishedNames {
    return new pkijs.RelativeDistinguishedNames({
        typesAndValues: entries.map(
            ([type, value]) =>
                new pkijs.AttributeTypeAndValue({
                    type,
                    value: type === OID.email ? new asn1js.IA5String({ value }) : new asn1js.Utf8String({ value }),
                }),
        ),
    })
}

export async function createSelfSigned(opts: { name: string; email?: string; org?: string; years?: number }): Promise<SelfSigned> {
    const name = opts.name.trim()
    if (!name) throw new Error(t().signing.errors.badName)
    const keys = await subtle().generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
    )
    const entries: [string, string][] = [[OID.commonName, name]]
    if (opts.org?.trim()) entries.push([OID.organization, opts.org.trim()])
    if (opts.email?.trim()) entries.push([OID.email, opts.email.trim()])

    const cert = new pkijs.Certificate()
    cert.version = 2
    const serial = globalThis.crypto.getRandomValues(new Uint8Array(16))
    serial[0] &= 0x7f
    cert.serialNumber = new asn1js.Integer({ valueHex: serial.buffer })
    cert.subject = rdn(entries)
    cert.issuer = rdn(entries)
    const now = Date.now()
    cert.notBefore.value = new Date(now - 60_000)
    cert.notAfter.value = new Date(now + (opts.years ?? 3) * 365 * 86_400_000)
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey)
    const keyId = await subtle().digest('SHA-1', own(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView))
    cert.extensions = [
        new pkijs.Extension({
            extnID: OID.basicConstraints,
            critical: true,
            extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false),
        }),
        new pkijs.Extension({
            extnID: OID.keyUsage,
            critical: true,
            extnValue: new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 }).toBER(false),
        }),
        new pkijs.Extension({
            extnID: OID.extKeyUsage,
            extnValue: new pkijs.ExtKeyUsage({ keyPurposes: [OID.emailProtection, OID.documentSigning] }).toSchema().toBER(false),
        }),
        new pkijs.Extension({
            extnID: OID.subjectKeyId,
            extnValue: new asn1js.OctetString({ valueHex: keyId }).toBER(false),
        }),
    ]
    await cert.sign(keys.privateKey, 'SHA-256')
    return {
        key: new Uint8Array(await subtle().exportKey('pkcs8', keys.privateKey)),
        cert: new Uint8Array(cert.toSchema(true).toBER(false)),
    }
}

export async function p12Signer(bytes: Uint8Array, password: string): Promise<Signer> {
    try {
        return await P12Signer.create(bytes, password)
    } catch (e) {
        const msg = (e as Error).message
        if (/no private key/i.test(msg)) throw new Error(t().signing.errors.noKey)
        if (/unsupported/i.test(msg)) throw new Error(t().signing.errors.unsupportedKey(msg))
        throw new Error(t().signing.errors.badPassword)
    }
}

export async function keySigner(key: Uint8Array, cert: Uint8Array): Promise<Signer> {
    const k = await subtle().importKey('pkcs8', own(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    return new CryptoKeySigner(k, cert, 'RSA', 'RSASSA-PKCS1-v1_5')
}

export interface Tsa {
    url: string
    headers?: Record<string, string>
    fetch?: typeof globalThis.fetch
}

export function checkTsaUrl(url: string): string {
    const u = url.trim()
    if (!/^https?:\/\/[^\s/]+/i.test(u)) throw new Error(t().signing.errors.tsaUrl)
    return u
}

export interface SignPdfOptions {
    signer: Signer
    reason?: string
    location?: string
    contactInfo?: string
    tsa?: Tsa
    longTerm?: boolean
}

export async function signPdf(bytes: Uint8Array, opts: SignPdfOptions): Promise<Uint8Array> {
    assertValid(await certSummary(opts.signer.certificate))
    const pdf = await PDF.load(bytes)
    const tsa = opts.tsa
        ? new HttpTimestampAuthority(checkTsaUrl(opts.tsa.url), { headers: opts.tsa.headers, fetch: opts.tsa.fetch, timeout: 15_000 })
        : undefined
    try {
        const result = await pdf.sign({
            signer: opts.signer,
            reason: opts.reason || undefined,
            location: opts.location || undefined,
            contactInfo: opts.contactInfo || undefined,
            level: tsa ? (opts.longTerm ? 'B-LT' : 'B-T') : 'B-B',
            timestampAuthority: tsa,
        })
        return result.bytes
    } catch (e) {
        if (e instanceof TimestampError) throw new TsaError(t().signing.errors.tsa((e as Error).message))
        throw new Error(t().signing.errors.sign((e as Error).message))
    }
}

export interface PdfSignatureInfo {
    signer: string
    signedAt?: string
}

function pdfDate(raw: string | undefined): string | undefined {
    const m = raw ? /D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(raw) : null
    if (!m) return undefined
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

export function listSignatures(bytes: Uint8Array): PdfSignatureInfo[] {
    const text = Buffer.from(bytes).toString('latin1')
    const out: PdfSignatureInfo[] = []
    for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
        const [a, b, c] = m.slice(1, 4).map(Number)
        if (!(a + b < c && c <= text.length)) continue
        const hexContents = text
            .slice(a + b, c)
            .replace(/[<>\s]/g, '')
            .replace(/(00)+$/, '')
        const around = text.slice(Math.max(0, m.index - 2000), Math.min(text.length, c + 2000))
        const signedAt = pdfDate(/\/M\s*\(([^)]*)\)/.exec(around)?.[1])
        let signer = ''
        try {
            const info = new pkijs.ContentInfo({ schema: asn1js.fromBER(Buffer.from(hexContents, 'hex')).result })
            const sd = new pkijs.SignedData({ schema: info.content })
            const sid = sd.signerInfos[0]?.sid
            const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate)
            const cert =
                (sid instanceof pkijs.IssuerAndSerialNumber && certs.find((x) => x.serialNumber.isEqual(sid.serialNumber) && x.issuer.isEqual(sid.issuer))) ||
                certs[0]
            if (cert) signer = displayName(cert.subject)
        } catch {
            continue
        }
        out.push({ signer, ...(signedAt ? { signedAt } : {}) })
    }
    return out
}
