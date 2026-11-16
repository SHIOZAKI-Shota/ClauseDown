import { createHash } from 'node:crypto'
import { t } from '../shared/i18n'
import { pae, type DsseEnvelope } from '../shared/attestation'
import {
    cleanDraft,
    cleanPolicyDoc,
    draftOf,
    keyValidAt,
    POLICY_TYPE,
    rulesOf,
    type PolicyDoc,
    type PolicyDraft,
    type PolicyKey,
    type PolicyPerson,
} from '../shared/policy'
import { DEFAULT_RULES, type RepoRules } from '../shared/review'
import type { PolicyPending, PolicyStatus, PolicyWarning } from '../shared/api'
import { author, identity } from './git-base'
import { RECORD, readRecord, readRecordEntries, writeRecord } from './records'
import { repoRoot } from './repo-id'
import { repoKey } from './repo-lock'
import { loadSettings, updateSettings } from './settings'
import { appKey } from './signing'
import { blobOfPublicKey, fingerprintOf, keyFromBlob, publicKeyLine, verifyRaw } from './ssh-sig'

export const POLICY_PAYLOAD = 'application/vnd.clausedown.policy+json'

export interface PolicyFile {
    envelope: DsseEnvelope
    publicKeys: string[]
}

interface Candidate {
    file: string
    doc: PolicyDoc
    hash: string
    payload: Buffer
    signers: Set<string>
}

const NAME_RE = /^policy\/(\d{6})-([0-9a-f]{8})\.json$/

const fpOf = (publicKey: string) => {
    const blob = blobOfPublicKey(publicKey)
    return blob ? fingerprintOf(blob) : null
}

function verifiedSigners(file: PolicyFile, payload: Buffer): Set<string> {
    const out = new Set<string>()
    const keys = new Map<string, string>()
    for (const k of Array.isArray(file.publicKeys) ? file.publicKeys : []) {
        const fp = typeof k === 'string' ? fpOf(k) : null
        if (fp) keys.set(fp, k)
    }
    const message = pae(file.envelope.payloadType, payload)
    for (const s of Array.isArray(file.envelope.signatures) ? file.envelope.signatures : []) {
        const publicKey = keys.get(s?.keyid)
        if (!publicKey) continue
        try {
            const { key, type } = keyFromBlob(blobOfPublicKey(publicKey)!)
            if (verifyRaw(type, key, message, Buffer.from(s.sig, 'base64'))) out.add(s.keyid)
        } catch {}
    }
    return out
}

function parse(file: string, raw: PolicyFile): Candidate | null {
    if (!NAME_RE.test(file) || !raw?.envelope || raw.envelope.payloadType !== POLICY_PAYLOAD || typeof raw.envelope.payload !== 'string') return null
    const payload = Buffer.from(raw.envelope.payload, 'base64')
    let doc: PolicyDoc | null = null
    try {
        doc = cleanPolicyDoc(JSON.parse(payload.toString()))
    } catch {
        return null
    }
    if (!doc) return null
    const hash = createHash('sha256').update(payload).digest('hex')
    const [, version, short] = NAME_RE.exec(file)!
    if (Number(version) !== doc.version || !hash.startsWith(short)) return null
    return { file, doc, hash, payload, signers: verifiedSigners(raw, payload) }
}

function signersAmong(people: PolicyPerson[], c: Candidate, at: string): PolicyPerson[] {
    return people.filter((p) => p.keys.some((k) => keyValidAt(k, at) && c.signers.has(fpOf(k.publicKey) ?? '')))
}

function newAdminKeys(prev: PolicyDoc | null, next: PolicyDoc): PolicyKey[] {
    const known = new Set((prev?.admins ?? []).flatMap((a) => a.keys.map((k) => k.publicKey)))
    return next.admins.flatMap((a) => a.keys).filter((k) => !known.has(k.publicKey))
}

function accepts(prev: PolicyDoc | null, c: Candidate): { ok: boolean; have: number; needed: number } {
    const base = prev ?? c.doc
    const have = signersAmong(base.admins, c, c.doc.createdAt).length
    const needed = base.adminThreshold
    const selfSigned = newAdminKeys(prev, c.doc).every((k) => c.signers.has(fpOf(k.publicKey) ?? ''))
    return { ok: have >= needed && selfSigned, have, needed }
}

const byAge = (a: Candidate, b: Candidate) => a.doc.createdAt.localeCompare(b.doc.createdAt) || a.hash.localeCompare(b.hash)

export interface PolicyChain {
    head: Candidate | null
    genesis: Candidate | null
    warnings: PolicyWarning[]
    pending: { c: Candidate; have: number; needed: number }[]
}

export async function readChain(dir: string): Promise<PolicyChain> {
    const entries = await readRecordEntries<PolicyFile>(dir, RECORD.policy)
    const repo = await repoRoot(dir).catch(() => '')
    const all = entries.map(([f, v]) => parse(f, v)).filter((c): c is Candidate => !!c && (!repo || c.doc.repo === repo))
    const warnings: PolicyWarning[] = []
    if (entries.length > all.length) warnings.push({ kind: 'invalid', version: 0 })
    const byVersion = new Map<number, Candidate[]>()
    for (const c of all) byVersion.set(c.doc.version, [...(byVersion.get(c.doc.version) ?? []), c].sort(byAge))

    const pins = (await loadSettings()).policyPins?.[repoKey(dir)]
    const firsts = (byVersion.get(1) ?? []).filter((c) => c.doc.previous === null && accepts(null, c).ok)
    const genesis = (pins && firsts.find((c) => c.hash === pins.genesis)) ?? firsts[0] ?? null
    if (firsts.length > 1) warnings.push({ kind: 'forked', version: 1 })
    const pending: PolicyChain['pending'] = []
    if (!genesis) return { head: null, genesis: null, warnings, pending }

    let head = genesis
    for (let v = 2; byVersion.has(v); v++) {
        const next = (byVersion.get(v) ?? []).filter((c) => c.doc.previous === head.hash)
        const ok = next.filter((c) => accepts(head.doc, c).ok)
        for (const c of next) {
            if (ok.includes(c)) continue
            const r = accepts(head.doc, c)
            if (c.signers.size) pending.push({ c, have: r.have, needed: r.needed })
        }
        if (!ok.length) {
            if (!next.length || next.every((c) => !c.signers.size)) warnings.push({ kind: 'unapproved', version: v })
            break
        }
        if (ok.length > 1) warnings.push({ kind: 'forked', version: v })
        head = ok[0]
    }
    const orphans = all.filter((c) => c.doc.version > head.doc.version + 1 || (c.doc.version === head.doc.version + 1 && c.doc.previous !== head.hash))
    if (orphans.length) warnings.push({ kind: 'unapproved', version: Math.min(...orphans.map((c) => c.doc.version)) })
    return { head, genesis, warnings, pending }
}

async function pinned(dir: string, chain: PolicyChain): Promise<{ doc: PolicyDoc | null; warnings: PolicyWarning[] }> {
    const key = repoKey(dir)
    const pin = (await loadSettings()).policyPins?.[key]
    const warnings: PolicyWarning[] = []
    if (pin && chain.genesis && pin.genesis !== chain.genesis.hash) warnings.push({ kind: 'genesisChanged', version: 1 })
    else if (pin && !chain.genesis) warnings.push({ kind: 'removed', version: pin.version })
    else if (pin && chain.head && chain.head.doc.version < pin.version) warnings.push({ kind: 'rollback', version: pin.version })
    if (warnings.length) return { doc: cleanPolicyDoc(pin?.doc), warnings }
    if (chain.head && (!pin || chain.head.doc.version > pin.version)) {
        const head = chain.head
        await updateSettings((s) => ({
            ...s,
            policyPins: { ...s.policyPins, [key]: { genesis: chain.genesis!.hash, version: head.doc.version, doc: head.doc } },
        })).catch(() => {})
    }
    return { doc: chain.head?.doc ?? null, warnings }
}

async function legacyRules(dir: string): Promise<RepoRules> {
    const r = (await readRecord<RepoRules>(dir, RECORD.rules)) as Partial<RepoRules> | null
    return {
        requireApproval: typeof r?.requireApproval === 'boolean' ? r.requireApproval : DEFAULT_RULES.requireApproval,
        approvers: Array.isArray(r?.approvers) ? r.approvers.filter((a): a is string => typeof a === 'string') : DEFAULT_RULES.approvers,
        requireSignedApproval: r?.requireSignedApproval === true,
    }
}

export interface LoadedPolicy {
    rules: RepoRules
    doc: PolicyDoc | null
    chain: PolicyChain
    warnings: PolicyWarning[]
}

export async function loadPolicy(dir: string): Promise<LoadedPolicy> {
    const chain = await readChain(dir)
    const { doc, warnings } = await pinned(dir, chain)
    if (!doc) return { rules: await legacyRules(dir), doc: null, chain, warnings: [...chain.warnings, ...warnings] }
    return { rules: rulesOf(doc), doc, chain, warnings: [...chain.warnings, ...warnings] }
}

async function signer() {
    const key = await appKey().catch(() => null)
    if (!key) throw new Error(t().signing.errors.noSshKey)
    return { key, publicKey: publicKeyLine(key.blob), fingerprint: fingerprintOf(key.blob) }
}

async function who(dir: string): Promise<{ name: string; login?: string }> {
    const id = await identity(dir).catch(() => null)
    if (id?.name) return { name: id.name, ...(id.login ? { login: id.login } : {}) }
    return { name: (await author(dir)).name }
}

async function signPayload(payload: Buffer, key: Awaited<ReturnType<typeof signer>>) {
    return { keyid: key.fingerprint, sig: (await key.key.sign(pae(POLICY_PAYLOAD, payload))).toString('base64') }
}

async function writeCandidate(dir: string, doc: PolicyDoc, key: Awaited<ReturnType<typeof signer>>): Promise<string> {
    const payload = Buffer.from(JSON.stringify(doc))
    const hash = createHash('sha256').update(payload).digest('hex')
    const file = `${RECORD.policy}${String(doc.version).padStart(6, '0')}-${hash.slice(0, 8)}.json`
    const body: PolicyFile = {
        envelope: { payload: payload.toString('base64'), payloadType: POLICY_PAYLOAD, signatures: [await signPayload(payload, key)] },
        publicKeys: [key.publicKey],
    }
    await writeRecord(dir, file, body)
    return file
}

const meAs = (me: { name: string; login?: string }, publicKey: string): PolicyPerson => ({
    name: me.name,
    ...(me.login ? { login: me.login } : {}),
    keys: [{ publicKey, validFrom: new Date(Date.now() - 60_000).toISOString() }],
})

const samePerson = (p: { name: string; login?: string }, me: { name: string; login?: string }) =>
    p.login && me.login ? p.login.toLowerCase() === me.login.toLowerCase() : !p.login && p.name === me.name

export async function signLegacyRules(dir: string): Promise<PolicyStatus> {
    const chain = await readChain(dir)
    if (chain.head) throw new Error(t().signing.policy.errors.alreadySigned)
    const key = await signer()
    const me = await who(dir)
    const legacy = await legacyRules(dir)
    const approvers = legacy.approvers.map((a): PolicyPerson => {
        const v = a.trim()
        const person: PolicyPerson = v.startsWith('@') ? { name: v.slice(1), login: v.slice(1), keys: [] } : { name: v, keys: [] }
        return samePerson(person, me) ? { ...person, keys: meAs(me, key.publicKey).keys } : person
    })
    const draft = cleanDraft({ ...legacy, approvalThreshold: 1, approvers, admins: [meAs(me, key.publicKey)], adminThreshold: 1 })
    const doc: PolicyDoc = {
        _type: POLICY_TYPE,
        version: 1,
        previous: null,
        repo: await repoRoot(dir),
        ...draft,
        createdAt: new Date().toISOString(),
        createdBy: me.name,
    }
    await writeCandidate(dir, doc, key)
    return policyStatus(dir)
}

export async function proposePolicy(dir: string, input: PolicyDraft): Promise<PolicyStatus> {
    const { doc: current, chain, warnings } = await loadPolicy(dir)
    if (!current || !chain.head) throw new Error(t().signing.policy.errors.notSigned)
    if (warnings.some((w) => w.kind === 'genesisChanged' || w.kind === 'rollback' || w.kind === 'removed')) throw new Error(t().signing.policy.errors.untrusted)
    const key = await signer()
    const draft = cleanDraft(input)
    if (!draft.admins.length || draft.admins.every((a) => !a.keys.length)) throw new Error(t().signing.policy.errors.noAdmin)
    const doc: PolicyDoc = {
        _type: POLICY_TYPE,
        version: current.version + 1,
        previous: chain.head.hash,
        repo: current.repo,
        ...draft,
        createdAt: new Date().toISOString(),
        createdBy: (await who(dir)).name,
    }
    await writeCandidate(dir, doc, key)
    return policyStatus(dir)
}

export async function cosignPolicy(dir: string, file: string): Promise<PolicyStatus> {
    if (!NAME_RE.test(file)) throw new Error(t().signing.policy.errors.notFound)
    const raw = await readRecord<PolicyFile>(dir, file)
    const c = raw ? parse(file, raw) : null
    if (!raw || !c) throw new Error(t().signing.policy.errors.notFound)
    const key = await signer()
    if (c.signers.has(key.fingerprint)) return policyStatus(dir)
    const next: PolicyFile = {
        envelope: { ...raw.envelope, signatures: [...raw.envelope.signatures, await signPayload(c.payload, key)] },
        publicKeys: [...new Set([...raw.publicKeys, key.publicKey])],
    }
    await writeRecord(dir, file, next)
    return policyStatus(dir)
}

export async function acceptGenesisChange(dir: string): Promise<PolicyStatus> {
    const key = repoKey(dir)
    await updateSettings((s) => {
        const pins = { ...s.policyPins }
        delete pins[key]
        return { ...s, policyPins: pins }
    })
    return policyStatus(dir)
}

const short = (hash: string) =>
    hash
        .slice(0, 16)
        .replace(/(.{4})/g, '$1 ')
        .trim()

export async function policyStatus(dir: string): Promise<PolicyStatus> {
    const loaded = await loadPolicy(dir)
    const key = await appKey().catch(() => null)
    const mine = key ? publicKeyLine(key.blob) : null
    const myFp = mine ? fpOf(mine) : null
    const me = await who(dir)
    const holds = (people: PolicyPerson[]) => !!mine && people.some((p) => p.keys.some((k) => k.publicKey === mine && keyValidAt(k, Date.now())))
    const pending: PolicyPending[] = loaded.chain.pending.map(({ c, have, needed }) => ({
        file: c.file,
        version: c.doc.version,
        createdAt: c.doc.createdAt,
        createdBy: c.doc.createdBy,
        have,
        needed,
        signedByMe: !!myFp && c.signers.has(myFp),
        draft: draftOf(c.doc),
    }))
    return {
        signed: !!loaded.doc,
        version: loaded.doc?.version ?? 0,
        genesis: loaded.chain.genesis ? short(loaded.chain.genesis.hash) : '',
        draft: loaded.doc
            ? draftOf(loaded.doc)
            : cleanDraft({
                  ...loaded.rules,
                  approvers: loaded.rules.approvers.map((a) => (a.startsWith('@') ? { name: a.slice(1), login: a.slice(1), keys: [] } : { name: a, keys: [] })),
              }),
        warnings: loaded.warnings,
        pending,
        me: {
            ...me,
            publicKey: mine ?? undefined,
            previousKeys: (await loadSettings()).signing?.commit.previousKeys ?? [],
            isAdmin: loaded.doc ? holds(loaded.doc.admins) : false,
            isApprover: loaded.doc ? holds(loaded.doc.approvers) : false,
        },
    }
}
