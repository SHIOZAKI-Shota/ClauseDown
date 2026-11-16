import type { ReviewEvent } from './review'

export const IN_TOTO_TYPE = 'application/vnd.in-toto+json'
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1'
export const REVIEW_PREDICATE = 'https://clausedown.app/attestation/review/v1'

export interface DsseSignature {
    keyid: string
    sig: string
}

export interface DsseEnvelope {
    payload: string
    payloadType: string
    signatures: DsseSignature[]
}

export interface ReviewPredicate {
    action: ReviewEvent['action']
    repo: string
    id: string
    by: string
    login: string
    at: string
    comment: string
}

export interface ReviewStatement {
    _type: typeof STATEMENT_TYPE
    subject: { name: string; digest: { gitCommit: string } }[]
    predicateType: typeof REVIEW_PREDICATE
    predicate: ReviewPredicate
}

export function reviewStatement(e: ReviewEvent, repo: string): ReviewStatement {
    return {
        _type: STATEMENT_TYPE,
        subject: [{ name: e.branch, digest: { gitCommit: e.oid } }],
        predicateType: REVIEW_PREDICATE,
        predicate: {
            action: e.action,
            repo,
            id: e.id,
            by: e.by,
            login: e.byLogin ?? e.forgeUser ?? '',
            at: e.at,
            comment: e.text,
        },
    }
}

const utf8 = new TextEncoder()

export function pae(payloadType: string, body: Uint8Array): Uint8Array {
    const head = utf8.encode(`DSSEv1 ${utf8.encode(payloadType).length} ${payloadType} ${body.length} `)
    const out = new Uint8Array(head.length + body.length)
    out.set(head)
    out.set(body, head.length)
    return out
}

export function statementMatches(s: ReviewStatement, e: ReviewEvent, repo: string): boolean {
    const want = reviewStatement(e, repo)
    return (
        s._type === STATEMENT_TYPE &&
        s.predicateType === REVIEW_PREDICATE &&
        s.subject?.length === 1 &&
        s.subject[0].name === want.subject[0].name &&
        s.subject[0].digest?.gitCommit === want.subject[0].digest.gitCommit &&
        s.predicate?.action === want.predicate.action &&
        s.predicate.repo === want.predicate.repo &&
        s.predicate.id === want.predicate.id &&
        s.predicate.by === want.predicate.by &&
        s.predicate.login === want.predicate.login &&
        s.predicate.at === want.predicate.at &&
        s.predicate.comment === want.predicate.comment
    )
}
