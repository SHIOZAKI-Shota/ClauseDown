import { tagPath } from '../shared/tag-path'
import { promises as fsp } from 'node:fs'
import { t } from '../shared/i18n'
import { join } from 'node:path'
import fs from 'node:fs'
import git from './igit'
import type { ConflictChoice, DeliverInput, DeliveryRecord, MergeInput, SyncState } from '../shared/api'
import { DEFAULT_RULES, prOf, reviewStatus, type RepoRules, type ReviewAction, type ReviewEvent } from '../shared/review'
import { parseLegal } from '../shared/legal-parser'
import { author, identity } from './git-base'
import * as g from './git'
import { forgeOf } from './forge'
import { newId, readRecords, RECORD, writeRecord } from './records'
import { repoKey } from './repo-lock'
import { afterMain, newOnMain, reviewBodyLines } from './issues'
import { appKey, signingSettings, signOpts } from './signing'
import { repoRoot } from './repo-id'
import { loadPolicy, readChain } from './policy'
import { keyValidAt } from '../shared/policy'
import { dsseSign, verifyReviewEvent } from './attest'
import { reviewStatement } from '../shared/attestation'
import { keyring } from './verify'
import { fingerprintOf, blobOfPublicKey } from './ssh-sig'

export async function getRules(dir: string): Promise<RepoRules> {
    return (await loadPolicy(dir)).rules
}

export async function saveRules(dir: string, rules: RepoRules): Promise<void> {
    if ((await readChain(dir)).head) throw new Error(t().signing.policy.errors.signedRules)
    const clean: RepoRules = {
        requireApproval: !!rules.requireApproval,
        approvers: [...new Set(rules.approvers.map((a) => a.trim()).filter(Boolean))],
        requireSignedApproval: !!rules.requireApproval && !!rules.requireSignedApproval,
    }
    await writeRecord(dir, RECORD.rules, clean)
}

export { forgeKind } from './forge'

function openRequests(events: ReviewEvent[]): Map<string, ReviewEvent> {
    const map = new Map<string, ReviewEvent>()
    for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
        if (e.action === 'request') map.set(e.branch, e)
        if (e.action === 'withdraw') map.delete(e.branch)
    }
    return map
}

const isStr = (v: unknown): v is string => typeof v === 'string'

const DECISION_TTL = 60_000
const decisionMemo = new Map<string, Map<string, { at: number; events: ReviewEvent[] }>>()

export { repoRoot } from './repo-id'

async function annotateSignatures(dir: string, events: ReviewEvent[]): Promise<ReviewEvent[]> {
    if (!events.some((e) => e.attestation)) return events
    const root = await repoRoot(dir).catch(() => '')
    const ring = await keyring(dir).catch(() => new Map())
    const pinnedKeys = (await getRules(dir).catch(() => DEFAULT_RULES)).approverKeys ?? {}
    const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
    const verified = (e: ReviewEvent) => {
        if (!e.attestation) return false
        const r = verifyReviewEvent(e, root)
        if (!r.ok || !r.fingerprint) return false
        const login = e.byLogin ?? e.forgeUser
        const keys = (login && pinnedKeys[`@${login}`]) || pinnedKeys[e.by]
        if (keys) return keys.some((k) => keyValidAt(k, e.at) && fingerprintOf(blobOfPublicKey(k.publicKey) ?? Buffer.alloc(0)) === r.fingerprint)
        const who = ring.get(r.fingerprint)
        if (!who) return false
        if (who.source === 'forge') return same(who.login, login)
        return login ? same(who.login, login) || (!who.login && who.name === e.by) : who.name === e.by || who.source === 'own'
    }
    for (const e of events) if (e.attestation) e.signed = verified(e) ? 'verified' : 'unverified'
    const mirrors = events.filter((e) => e.mirror && e.signed === 'verified')
    for (const e of events) {
        if (e.source !== 'github' && e.source !== 'gitlab') continue
        const hit = mirrors.find((m) => m.branch === e.branch && m.oid === e.oid && m.action === e.action && same(m.byLogin, e.by))
        e.signed = hit ? 'verified' : 'unverified'
    }
    return events
}

export async function listReviews(dir: string, fresh = false): Promise<ReviewEvent[]> {
    return annotateSignatures(dir, await rawReviews(dir, fresh))
}

async function rawReviews(dir: string, fresh: boolean): Promise<ReviewEvent[]> {
    const events = (await readRecords<ReviewEvent>(dir, RECORD.reviews)).filter(
        (e) => e && isStr(e.branch) && isStr(e.action) && isStr(e.at) && (e.source ?? 'app') === 'app',
    )
    const forge = await forgeOf(dir)
    if (!forge) return events
    const memo = decisionMemo.get(repoKey(dir)) ?? new Map<string, { at: number; events: ReviewEvent[] }>()
    decisionMemo.set(repoKey(dir), memo)
    for (const [k, v] of memo) if (Date.now() - v.at >= DECISION_TTL) memo.delete(k)
    await Promise.all(
        [...openRequests(events).values()].map(async (req) => {
            const pr = prOf(req)
            if (!pr || (req.forge ?? 'github') !== forge.kind) return
            const head = await g.branchOid(dir, req.branch).catch(() => '')
            const key = `${forge.kind}|${req.id}|${pr}|${head}`
            const hit = memo.get(key)
            if (!fresh && hit && Date.now() - hit.at < DECISION_TTL) {
                events.push(...hit.events.map((e) => ({ ...e })))
                return
            }
            try {
                const got = await forge.decisions({ ...req, pr })
                memo.set(key, { at: Date.now(), events: got })
                events.push(...got.map((e) => ({ ...e })))
            } catch (e) {
                console.error('[review] リモートの承認状況を読めませんでした', req.branch, e)
            }
        }),
    )
    return events
}

export interface ReviewInput {
    branch: string
    action: ReviewAction
    text: string
}

const defaultText = (action: ReviewAction): string => (action === 'comment' ? '' : t().notify.review[action])

export async function addReview(dir: string, input: ReviewInput): Promise<void> {
    const text = input.text.trim() || defaultText(input.action)
    if (!text) throw new Error(t().errors.workflow.commentRequired)
    const main = await g.mainBranch(dir)
    if (input.branch === main) throw new Error(t().errors.workflow.reviewOnMain)
    const who = await identity(dir)
    if (!who) await author(dir)
    const ev: ReviewEvent = {
        id: newId(),
        branch: input.branch,
        action: input.action,
        oid: await g.branchOid(dir, input.branch),
        by: who!.name,
        ...(who!.login ? { byLogin: who!.login } : {}),
        at: new Date().toISOString(),
        text,
        source: 'app',
    }
    const events = await readRecords<ReviewEvent>(dir, RECORD.reviews)
    const open = openRequests(events.filter((e) => !e.mirror)).get(input.branch)
    if (input.action !== 'request' && !open) throw new Error(t().errors.workflow.noOpenRequest)
    const signIt = async (e: ReviewEvent) => {
        if (!(await signingSettings()).approvals.sign) return e
        const key = await appKey().catch(() => null)
        if (!key) return e
        const { envelope, publicKey } = await dsseSign(reviewStatement(e, await repoRoot(dir)), key)
        return { ...e, attestation: envelope, publicKey }
    }

    const forge = await forgeOf(dir)
    if (forge) {
        const pr = prOf(open)
        if (input.action === 'request') {
            await g.pushRef(dir, input.branch)
            const label = g.branchLabel(input.branch, main)
            const closes = await reviewBodyLines(dir, input.branch).catch(() => '')
            const r = await forge.openReview(
                input.branch,
                main,
                t().notify.review.title(label),
                `${text}\n\n${closes ? `${closes}\n\n` : ''}${t().notify.review.createdBy}`,
            )
            ev.pr = r.n
            ev.forge = forge.kind
            ev.forgeUser = r.author
            if (forge.kind === 'github') ev.githubPr = r.n
        } else if (pr && (open?.forge ?? 'github') === forge.kind) {
            if (input.action === 'withdraw') {
                await forge.closeReview(pr).catch(() => {})
            } else {
                const custom = input.text.trim() || input.action !== 'approve' ? text : null
                await forge.submit(pr, input.action, forge.kind === 'github' ? text : custom, ev.oid)
                decisionMemo.delete(repoKey(dir))
                const mirror = await signIt({ ...ev, mirror: { forge: forge.kind, pr } })
                if (mirror.attestation) await writeRecord(dir, `${RECORD.reviews}${ev.id}.json`, mirror)
                return
            }
        }
    }
    await writeRecord(dir, `${RECORD.reviews}${ev.id}.json`, await signIt(ev))
}

export async function publishSigningKey(dir: string): Promise<void> {
    const key = await appKey()
    const info = (await signingSettings()).commit.key
    if (!key || !info) throw new Error(t().signing.errors.noSshKey)
    const who = (await identity(dir)) ?? { name: (await author(dir)).name, login: undefined }
    const blob = blobOfPublicKey(info.publicKey)!
    const entry = { name: who.name, login: who.login, publicKey: info.publicKey, at: new Date().toISOString() }
    const { envelope } = await dsseSign({ _type: 'https://clausedown.app/signer/v1', ...entry }, key)
    await writeRecord(dir, `${RECORD.signers}${fingerprintOf(blob).replace(/[^A-Za-z0-9]/g, '')}.json`, { ...entry, attestation: envelope })
}

function approvalTrailers(status: ReturnType<typeof reviewStatus>, tip: string): string {
    const after = status.request ? Date.parse(status.request.at) : 0
    const seen = new Set<string>()
    const lines: string[] = []
    for (const e of status.events) {
        if (e.action !== 'approve' || e.oid !== tip || Date.parse(e.at) < after) continue
        const login = e.source === 'github' || e.source === 'gitlab' ? e.by : (e.byLogin ?? e.forgeUser)
        const name = e.by
        const id = (login ?? name).toLowerCase()
        if (seen.has(id)) continue
        seen.add(id)
        lines.push(`Approved-by: ${name}${login && login !== name ? ` (@${login})` : ''}${e.signed === 'verified' ? ' [signed]' : ''}`)
    }
    return lines.length ? `\n\n${lines.join('\n')}` : ''
}

export async function adoptOrMerge(dir: string, input: MergeInput): Promise<SyncState> {
    const main = await g.mainBranch(dir)
    if (input.into !== main) return g.mergeBranch(dir, input)
    const before = await g.branchOid(dir, main).catch(() => null)
    const state = await mergeIntoMain(dir, input, main)
    if (state.state !== 'error') {
        const after = await g.branchOid(dir, main).catch(() => null)
        if (after && after !== before) await afterMain(dir, await newOnMain(dir, before, after), input.from).catch(() => {})
    }
    return state
}

async function mergeIntoMain(dir: string, input: MergeInput, main: string): Promise<SyncState> {
    const rules = await getRules(dir)
    const events = await listReviews(dir, true)
    const tip = await g.branchOid(dir, input.from)
    const status = reviewStatus(events, input.from, tip, rules)
    if (!status.canMerge) throw new Error(status.reason)
    input = { ...input, message: input.message + approvalTrailers(status, tip) }

    const forge = await forgeOf(dir)
    const pr = prOf(status.request)
    if (!forge || !pr || (status.request?.forge ?? 'github') !== forge.kind) return g.mergeBranch(dir, input)
    const local = rules.requireSignedApproval || (await signingSettings()).commit.localMerge
    if (local && (await signOpts(dir, 'commit')).signingKey) return g.mergeBranch(dir, input)

    await g.requireClean(dir, t().errors.git.actions.merge)
    const preview = await g.previewMerge(dir, input.from, main)
    if (preview.conflicts.length) {
        const flipped: Record<string, ConflictChoice> = {}
        for (const [path, c] of Object.entries(input.choices)) {
            flipped[path] = c === 'ours' ? 'theirs' : c === 'theirs' ? 'ours' : c
        }
        const s = await g.mergeBranch(dir, {
            from: main,
            into: input.from,
            choices: flipped,
            message: t().notify.commits.mergedMain,
        })
        if (s.state === 'error') return s
    }
    await g.pushRef(dir, input.from)
    const mergedSha = await forge.merge(pr, input.message, await g.branchOid(dir, input.from))
    await g.switchBranch(dir, main)
    const s = await g.sync(dir)
    if (s.state === 'error') return s
    if (input.effectiveDate) {
        const docs = preview.files.filter((p) => p.toLowerCase().endsWith('.md'))
        await g.tagEffective(dir, docs.length ? docs : ['all'], input.effectiveDate, mergedSha)
    }
    const state = await g.push(dir)
    if (input.deleteAfter && state.state !== 'error') await g.deleteBranch(dir, input.from)
    return state
}

export interface Builders {
    docPdf(source: string): Promise<Uint8Array>
    docDocx(source: string): Promise<Uint8Array>
    cmpPdf(oldSource: string, newSource: string, title: string): Promise<Uint8Array>
    cmpDocx(oldSource: string, newSource: string, title: string): Promise<Uint8Array>
}

function safeName(s: string): string {
    const n = s
        // oxlint-disable-next-line no-control-regex -- ファイル名に使えない制御文字を除く
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .trim()
        .replace(/[. ]+$/, '')
    return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n) ? `${n}_` : n || '_'
}

const folderFile = (dir: string) => join(dir, '.git', 'clausedown-delivery-folders.json')

async function deliveryFolders(dir: string): Promise<Record<string, string>> {
    try {
        const j: unknown = JSON.parse(await fsp.readFile(folderFile(dir), 'utf8'))
        return j && typeof j === 'object' && !Array.isArray(j) ? Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string')) : {}
    } catch {
        return {}
    }
}

async function rememberFolder(dir: string, id: string, folder: string) {
    const all = await deliveryFolders(dir)
    all[id] = folder
    await fsp.writeFile(folderFile(dir), JSON.stringify(all, null, 2), 'utf8')
}

export async function recordReceived(dir: string, id: string, entry: NonNullable<DeliveryRecord['received']>[number]): Promise<void> {
    if (!/^[\w-]+$/.test(id)) return
    const name = `${RECORD.deliveries}${id}.json`
    const rec = (await readRecords<DeliveryRecord>(dir, RECORD.deliveries)).find((d) => d?.id === id)
    if (!rec) return
    await writeRecord(dir, name, { ...rec, folder: '', received: [...(rec.received ?? []), entry] })
}

export async function listDeliveries(dir: string, docPath?: string): Promise<DeliveryRecord[]> {
    const list = (await readRecords<DeliveryRecord>(dir, RECORD.deliveries)).filter((d) => d && isStr(d.docPath) && isStr(d.at) && Array.isArray(d.items))
    const folders = await deliveryFolders(dir)
    return list
        .filter((d) => !docPath || d.docPath === docPath)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((d) => ({ ...d, folder: (isStr(d.id) && Object.hasOwn(folders, d.id) && folders[d.id]) || '' }))
}

export async function deliver(dir: string, input: DeliverInput, outDir: string, build: Builders): Promise<DeliveryRecord> {
    if (!input.items.length) throw new Error(t().errors.workflow.nothingToDeliver)
    const source = await g.readAt(dir, input.oid, input.docPath)
    if (source === null) throw new Error(t().errors.workflow.docNotInVersion)
    const base = input.baseOid ? ((await g.readAt(dir, input.baseOid, input.docPath)) ?? '') : ''
    const title = parseLegal(source).title || input.docPath.replace(/\.md$/i, '')
    const client = input.docPath.includes('/') ? input.docPath.slice(0, input.docPath.lastIndexOf('/')) : ''
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    const folderName = safeName([stamp, client.replace(/\//g, '_'), title, t().notify.delivery.folder].filter(Boolean).join('_'))
    let folder = join(outDir, folderName)
    for (let i = 2; fs.existsSync(folder); i++) folder = join(outDir, `${folderName}(${i})`)
    await fsp.mkdir(folder, { recursive: true })

    const cmpTitle = t().notify.delivery.compareTitle(title)
    const files: { name: string; data: Uint8Array; type: string }[] = []
    const add = (name: string, data: Uint8Array, type: string) => files.push({ name: safeName(name), data, type })
    const PDF = 'application/pdf'
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    for (const item of input.items) {
        if (item === 'docPdf') add(`${title}.pdf`, await build.docPdf(source), PDF)
        if (item === 'docDocx') add(`${title}.docx`, await build.docDocx(source), DOCX)
        if (item === 'cmpPdf') add(`${cmpTitle}.pdf`, await build.cmpPdf(base, source, cmpTitle), PDF)
        if (item === 'cmpDocx') add(`${cmpTitle}.docx`, await build.cmpDocx(base, source, cmpTitle), DOCX)
    }
    for (const f of files) await fsp.writeFile(join(folder, f.name), f.data)

    const record: DeliveryRecord = {
        id: newId(),
        docPath: input.docPath,
        title,
        client,
        oid: input.oid,
        baseOid: input.baseOid,
        effectiveDate: input.effectiveDate,
        to: input.to,
        memo: input.memo,
        items: input.items,
        signed: input.sign || undefined,
        files: files.map((f) => f.name),
        folder,
        at: now.toISOString(),
        by: (await author(dir)).name,
    }

    const forge = await forgeOf(dir)
    if (input.publishRelease && forge) {
        record.releaseForge = forge.kind
        try {
            const tag = `納品/${tagPath(input.docPath)}/${record.id}`
            await git.annotatedTag({
                fs,
                dir,
                ref: tag,
                object: input.oid,
                message: t().notify.delivery.tagMessage(title, input.to),
                tagger: await author(dir),
                ...(await signOpts(dir, 'tag')),
            })
            await g.pushRef(dir, `refs/tags/${tag}`)
            const body = [
                t().notify.delivery.to(input.to || '—'),
                input.effectiveDate ? t().notify.delivery.effective(input.effectiveDate) : '',
                input.memo ? `\n${input.memo}` : '',
                t().notify.delivery.files(record.files.map((f) => `- ${f}`).join('\n')),
            ]
                .filter(Boolean)
                .join('\n')
            record.releaseUrl = await forge.release(tag, t().notify.delivery.releaseTitle(title, stamp, input.to ?? ''), body, files)
        } catch (e) {
            record.releaseError = (e as Error).message
        }
    }
    await writeRecord(dir, `${RECORD.deliveries}${record.id}.json`, { ...record, folder: '' })
    await rememberFolder(dir, record.id, folder)
    return record
}
