import type { KeyStorage } from '../shared/signing'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'

export const NS_GIT = 'git'

const MAGIC = Buffer.from('SSHSIG')
const BEGIN = '-----BEGIN SSH SIGNATURE-----'
const END = '-----END SSH SIGNATURE-----'

const u32 = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n)
    return b
}
const str = (v: Buffer | string) => {
    const b = typeof v === 'string' ? Buffer.from(v) : v
    return Buffer.concat([u32(b.length), b])
}

class Reader {
    private at = 0
    constructor(private buf: Buffer) {}
    bytes(n: number) {
        if (this.at + n > this.buf.length) throw new Error('truncated')
        const out = this.buf.subarray(this.at, this.at + n)
        this.at += n
        return out
    }
    u32() {
        return this.bytes(4).readUInt32BE()
    }
    str() {
        return this.bytes(this.u32())
    }
    text() {
        return this.str().toString()
    }
    done() {
        return this.at === this.buf.length
    }
}

const unsigned = (b: Buffer) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    return b.subarray(i)
}
const b64url = (b: Buffer) => b.toString('base64url')

const CURVES: Record<string, { crv: string; size: number; hash: string }> = {
    nistp256: { crv: 'P-256', size: 32, hash: 'sha256' },
    nistp384: { crv: 'P-384', size: 48, hash: 'sha384' },
    nistp521: { crv: 'P-521', size: 66, hash: 'sha512' },
}

export interface KeySigner {
    blob: Buffer
    storage: KeyStorage
    sign(data: Uint8Array): Promise<Buffer>
}

const mpint = (b: Buffer) => {
    const u = unsigned(b)
    return u[0] & 0x80 ? Buffer.concat([Buffer.alloc(1), u]) : u
}

export function generateSshKey(): { pem: string; publicKey: string; fingerprint: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const blob = publicBlob(publicKey)
    return {
        pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
        publicKey: publicKeyLine(blob),
        fingerprint: fingerprintOf(blob),
    }
}

export function softSigner(privateKey: KeyObject, storage: KeyStorage = 'app'): KeySigner {
    const blob = publicBlob(createPublicKey(privateKey))
    const type = keyTypeOf(blob)
    const alg = type === 'ssh-ed25519' ? null : type === 'ssh-rsa' ? 'sha256' : CURVES[type.slice('ecdsa-sha2-'.length)].hash
    return { blob, storage, sign: async (data) => sign(alg, data, privateKey) }
}

export function loadSshKey(pem: string): KeySigner {
    const privateKey = createPrivateKey(pem)
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('ed25519 key expected')
    return softSigner(privateKey)
}

export function publicBlob(pub: KeyObject): Buffer {
    const jwk = pub.export({ format: 'jwk' })
    if (pub.asymmetricKeyType === 'ed25519') return Buffer.concat([str('ssh-ed25519'), str(Buffer.from(jwk.x as string, 'base64url'))])
    if (pub.asymmetricKeyType === 'rsa')
        return Buffer.concat([str('ssh-rsa'), str(mpint(Buffer.from(jwk.e as string, 'base64url'))), str(mpint(Buffer.from(jwk.n as string, 'base64url')))])
    const curve = Object.entries(CURVES).find(([, c]) => c.crv === jwk.crv)?.[0]
    if (pub.asymmetricKeyType === 'ec' && curve) {
        const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x as string, 'base64url'), Buffer.from(jwk.y as string, 'base64url')])
        return Buffer.concat([str(`ecdsa-sha2-${curve}`), str(curve), str(point)])
    }
    throw new Error(`unsupported key ${pub.asymmetricKeyType}`)
}

export function p256Blob(point: Buffer): Buffer {
    if (point.length !== 65 || point[0] !== 4) throw new Error('bad point')
    return Buffer.concat([str('ecdsa-sha2-nistp256'), str('nistp256'), str(point)])
}

export const keyTypeOf = (blob: Buffer) => new Reader(blob).text()

export const fingerprintOf = (blob: Buffer) => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`

export const publicKeyLine = (blob: Buffer) => `${keyTypeOf(blob)} ${blob.toString('base64')}`

export function blobOfPublicKey(line: string): Buffer | null {
    const m = /^\s*(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+([A-Za-z0-9+/=]+)/.exec(line)
    if (!m) return null
    const blob = Buffer.from(m[2], 'base64')
    try {
        if (new Reader(blob).text() !== m[1]) return null
    } catch {
        return null
    }
    return blob
}

export function keyFromBlob(blob: Buffer): { key: KeyObject; type: string } {
    const r = new Reader(blob)
    const type = r.text()
    if (type === 'ssh-ed25519') {
        return { type, key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(r.str()) }, format: 'jwk' }) }
    }
    if (type === 'ssh-rsa') {
        const e = unsigned(r.str())
        const n = unsigned(r.str())
        return { type, key: createPublicKey({ key: { kty: 'RSA', e: b64url(e), n: b64url(n) }, format: 'jwk' }) }
    }
    const curve = /^ecdsa-sha2-(nistp\d+)$/.exec(type)?.[1]
    if (curve && CURVES[curve]) {
        r.text()
        const q = r.str()
        const size = CURVES[curve].size
        if (q[0] !== 4 || q.length !== 1 + size * 2) throw new Error('bad point')
        const key = createPublicKey({
            key: { kty: 'EC', crv: CURVES[curve].crv, x: b64url(q.subarray(1, 1 + size)), y: b64url(q.subarray(1 + size)) },
            format: 'jwk',
        })
        return { type, key }
    }
    throw new Error(`unsupported key ${type}`)
}

function signedData(namespace: string, hashAlg: string, message: Buffer): Buffer {
    const digest = createHash(hashAlg).update(message).digest()
    return Buffer.concat([MAGIC, str(namespace), str(''), str(hashAlg), str(digest)])
}

const armor = (blob: Buffer) =>
    `${BEGIN}\n${blob
        .toString('base64')
        .match(/.{1,70}/g)!
        .join('\n')}\n${END}`

function derToRs(der: Buffer): [Buffer, Buffer] {
    const r = new Reader(der)
    const tag = (want: number) => {
        if (r.bytes(1)[0] !== want) throw new Error('bad der')
        let len = r.bytes(1)[0]
        if (len & 0x80) len = r.bytes(len & 0x7f).reduce((a, b) => a * 256 + b, 0)
        return len
    }
    tag(0x30)
    const a = r.bytes(tag(0x02))
    const b = r.bytes(tag(0x02))
    return [a, b]
}

export function sshSignatureBlob(type: string, raw: Buffer): Buffer {
    if (type === 'ssh-ed25519') return Buffer.concat([str(type), str(raw)])
    if (type === 'ssh-rsa') return Buffer.concat([str('rsa-sha2-256'), str(raw)])
    const [r, s] = derToRs(raw)
    return Buffer.concat([str(type), str(Buffer.concat([str(mpint(r)), str(mpint(s))]))])
}

export function verifyRaw(type: string, key: KeyObject, data: Uint8Array, sig: Buffer): boolean {
    if (type === 'ssh-ed25519') return verify(null, data, key, sig)
    if (type === 'ssh-rsa') return verify('sha256', data, key, sig)
    const c = CURVES[type.slice('ecdsa-sha2-'.length)]
    return !!c && verify(c.hash, data, key, sig)
}

export async function sshSign(message: Buffer | string, signer: KeySigner, namespace: string): Promise<string> {
    const msg = typeof message === 'string' ? Buffer.from(message) : message
    const raw = await signer.sign(signedData(namespace, 'sha512', msg))
    const blob = Buffer.concat([MAGIC, u32(1), str(signer.blob), str(namespace), str(''), str('sha512'), str(sshSignatureBlob(keyTypeOf(signer.blob), raw))])
    return armor(blob)
}

export interface SshVerifyResult {
    ok: boolean
    fingerprint?: string
    publicKey?: string
}

export function sshVerify(armored: string, message: Buffer | string, namespace: string): SshVerifyResult {
    const msg = typeof message === 'string' ? Buffer.from(message) : message
    try {
        const body = armored.trim()
        if (!body.startsWith(BEGIN) || !body.endsWith(END)) return { ok: false }
        const blob = Buffer.from(body.slice(BEGIN.length, -END.length).replace(/\s+/g, ''), 'base64')
        const r = new Reader(blob)
        if (!r.bytes(6).equals(MAGIC) || r.u32() !== 1) return { ok: false }
        const pub = r.str()
        const ns = r.text()
        r.str()
        const hashAlg = r.text()
        const sigBlob = r.str()
        if (!r.done()) return { ok: false }
        const fingerprint = fingerprintOf(pub)
        const { key, type } = keyFromBlob(pub)
        const publicKey = `${type} ${pub.toString('base64')}`
        if (ns !== namespace || (hashAlg !== 'sha512' && hashAlg !== 'sha256')) return { ok: false, fingerprint, publicKey }
        const s = new Reader(sigBlob)
        const sigType = s.text()
        const sig = s.str()
        const data = signedData(ns, hashAlg, msg)
        let ok = false
        if (type === 'ssh-ed25519' && sigType === 'ssh-ed25519') ok = verify(null, data, key, sig)
        else if (type === 'ssh-rsa' && (sigType === 'rsa-sha2-512' || sigType === 'rsa-sha2-256'))
            ok = verify(sigType === 'rsa-sha2-512' ? 'sha512' : 'sha256', data, key, sig)
        else if (type === sigType && type.startsWith('ecdsa-sha2-')) {
            const c = CURVES[type.slice('ecdsa-sha2-'.length)]
            const rs = new Reader(sig)
            const pad = (b: Buffer) => Buffer.concat([Buffer.alloc(Math.max(0, c.size - unsigned(b).length)), unsigned(b)])
            ok = verify(c.hash, data, { key, dsaEncoding: 'ieee-p1363' }, Buffer.concat([pad(rs.str()), pad(rs.str())]))
        }
        return { ok, fingerprint, publicKey }
    } catch {
        return { ok: false }
    }
}

export function commitPayload(raw: string): { payload: string; signature: string | null } {
    const end = raw.indexOf('\n\n')
    const head = end < 0 ? raw : raw.slice(0, end)
    const rest = end < 0 ? '' : raw.slice(end)
    const kept: string[] = []
    const sig: string[] = []
    let inSig = false
    for (const line of head.split('\n')) {
        if (line.startsWith('gpgsig ')) {
            inSig = true
            sig.push(line.slice(7))
        } else if (inSig && line.startsWith(' ')) sig.push(line.slice(1))
        else {
            inSig = false
            kept.push(line)
        }
    }
    return { payload: kept.join('\n') + rest, signature: sig.length ? sig.join('\n') : null }
}

export function tagPayload(raw: string): { payload: string; signature: string | null } {
    const at = raw.search(/-----BEGIN (SSH|PGP) SIGNATURE-----/)
    if (at < 0) return { payload: raw, signature: null }
    return { payload: raw.slice(0, at), signature: raw.slice(at).trimEnd() }
}

export function stripTagSignature(message: string): string {
    return tagPayload(message).payload.replace(/\n+$/, '\n')
}
