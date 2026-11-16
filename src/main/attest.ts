import { IN_TOTO_TYPE, pae, statementMatches, type DsseEnvelope, type ReviewStatement } from '../shared/attestation'
import type { ReviewEvent } from '../shared/review'
import { blobOfPublicKey, fingerprintOf, keyFromBlob, publicKeyLine, verifyRaw, type KeySigner } from './ssh-sig'

export async function dsseSign(statement: object, key: KeySigner): Promise<{ envelope: DsseEnvelope; publicKey: string }> {
    const body = Buffer.from(JSON.stringify(statement))
    const sig = await key.sign(pae(IN_TOTO_TYPE, body))
    return {
        envelope: {
            payload: body.toString('base64'),
            payloadType: IN_TOTO_TYPE,
            signatures: [{ keyid: fingerprintOf(key.blob), sig: sig.toString('base64') }],
        },
        publicKey: publicKeyLine(key.blob),
    }
}

export interface DsseResult {
    ok: boolean
    fingerprint?: string
    statement?: ReviewStatement
}

export function dsseVerify(envelope: DsseEnvelope | undefined, publicKey: string | undefined): DsseResult {
    if (!envelope || !publicKey || envelope.payloadType !== IN_TOTO_TYPE || !Array.isArray(envelope.signatures)) return { ok: false }
    const blob = blobOfPublicKey(publicKey)
    if (!blob) return { ok: false }
    const fingerprint = fingerprintOf(blob)
    try {
        const { key, type } = keyFromBlob(blob)
        const body = Buffer.from(envelope.payload, 'base64')
        const s = envelope.signatures.find((x) => x.keyid === fingerprint)
        if (!s) return { ok: false, fingerprint }
        const ok = verifyRaw(type, key, pae(IN_TOTO_TYPE, body), Buffer.from(s.sig, 'base64'))
        return { ok, fingerprint, statement: ok ? (JSON.parse(body.toString()) as ReviewStatement) : undefined }
    } catch {
        return { ok: false, fingerprint }
    }
}

export function verifyReviewEvent(e: ReviewEvent, repo: string): DsseResult {
    const r = dsseVerify(e.attestation, e.publicKey)
    if (!r.ok || !r.statement || !statementMatches(r.statement, e, repo)) return { ok: false, fingerprint: r.fingerprint }
    return r
}
