import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs'
import git from './igit'
import type { ConflictChoice, DeliverInput, DeliveryRecord, MergeInput, SyncState } from '../shared/api'
import { DEFAULT_RULES, prOf, reviewStatus, type RepoRules, type ReviewAction, type ReviewEvent } from '../shared/review'
import { parseLegal } from '../shared/legal-parser'
import { author, identity } from './git-base'
import * as g from './git'
import { forgeOf } from './forge'
import { newId, readRecord, readRecords, RECORD, writeRecord } from './records'
import { repoKey } from './repo-lock'
import { afterMain, newOnMain, reviewBodyLines } from './issues'

export async function getRules(dir: string): Promise<RepoRules> {
    return { ...DEFAULT_RULES, ...((await readRecord<RepoRules>(dir, RECORD.rules)) ?? {}) }
}

export async function saveRules(dir: string, rules: RepoRules): Promise<void> {
    const clean: RepoRules = {
        requireApproval: !!rules.requireApproval,
        approvers: [...new Set(rules.approvers.map((a) => a.trim()).filter(Boolean))],
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

export async function listReviews(dir: string, fresh = false): Promise<ReviewEvent[]> {
    const events = (await readRecords<ReviewEvent>(dir, RECORD.reviews)).filter(
        (e) => e && isStr(e.branch) && isStr(e.action) && isStr(e.at) && (e.source ?? 'app') === 'app',
    )
    const forge = await forgeOf(dir)
    if (!forge) return events
    const memo = decisionMemo.get(repoKey(dir)) ?? new Map<string, { at: number; events: ReviewEvent[] }>()
    decisionMemo.set(repoKey(dir), memo)
    for (const [k, v] of memo) if (Date.now() - v.at >= DECISION_TTL) memo.delete(k)
    await Promise.all([...openRequests(events).values()].map(async (req) => {
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
    }))
    return events
}

export interface ReviewInput {
    branch: string
    action: ReviewAction
    text: string
}

const DEFAULT_TEXT: Record<ReviewAction, string> = {
    request: '確認をお願いします',
    approve: '承認します',
    changes: '修正をお願いします',
    comment: '',
    withdraw: '確認依頼を取り下げます',
}

export async function addReview(dir: string, input: ReviewInput): Promise<void> {
    const text = input.text.trim() || DEFAULT_TEXT[input.action]
    if (!text) throw new Error('コメントを入力してください')
    const main = await g.mainBranch(dir)
    if (input.branch === main) throw new Error('現行版には確認を依頼できません。改定案を作ってください')
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
    const open = openRequests(events).get(input.branch)
    if (input.action !== 'request' && !open) throw new Error('この改定案には確認依頼が出ていません')

    const forge = await forgeOf(dir)
    if (forge) {
        const pr = prOf(open)
        if (input.action === 'request') {
            await g.pushRef(dir, input.branch)
            const label = g.branchLabel(input.branch, main)
            const closes = await reviewBodyLines(dir, input.branch).catch(() => '')
            const r = await forge.openReview(input.branch, main, `改定案「${label}」の確認依頼`, `${text}\n\n${closes ? `${closes}\n\n` : ''}（ClauseDown から作成）`)
            ev.pr = r.n
            ev.forge = forge.kind
            ev.forgeUser = r.author
            if (forge.kind === 'github') ev.githubPr = r.n
        } else if (pr && (open?.forge ?? 'github') === forge.kind) {
            if (input.action === 'withdraw') {
                await forge.closeReview(pr).catch(() => { })
            } else {
                const custom = input.text.trim() || input.action !== 'approve' ? text : null
                await forge.submit(pr, input.action, forge.kind === 'github' ? text : custom, ev.oid)
                decisionMemo.delete(repoKey(dir))
                return
            }
        }
    }
    await writeRecord(dir, `${RECORD.reviews}${ev.id}.json`, ev)
}

export async function adoptOrMerge(dir: string, input: MergeInput): Promise<SyncState> {
    const main = await g.mainBranch(dir)
    if (input.into !== main) return g.mergeBranch(dir, input)
    const before = await g.branchOid(dir, main).catch(() => null)
    const state = await mergeIntoMain(dir, input, main)
    if (state.state !== 'error') {
        const after = await g.branchOid(dir, main).catch(() => null)
        if (after && after !== before) await afterMain(dir, await newOnMain(dir, before, after), input.from).catch(() => { })
    }
    return state
}

async function mergeIntoMain(dir: string, input: MergeInput, main: string): Promise<SyncState> {

    const rules = await getRules(dir)
    const events = await listReviews(dir, true)
    const status = reviewStatus(events, input.from, await g.branchOid(dir, input.from), rules)
    if (!status.canMerge) throw new Error(status.reason)

    const forge = await forgeOf(dir)
    const pr = prOf(status.request)
    if (!forge || !pr || (status.request?.forge ?? 'github') !== forge.kind) return g.mergeBranch(dir, input)

    await g.requireClean(dir, '反映')
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
            message: '現行版の最新を取り込み、重なりを解決しました',
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
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .trim()
        .replace(/[. ]+$/, '')
    return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n) ? `${n}_` : n || '_'
}

export async function listDeliveries(dir: string, docPath?: string): Promise<DeliveryRecord[]> {
    const list = (await readRecords<DeliveryRecord>(dir, RECORD.deliveries)).filter(
        (d) => d && isStr(d.docPath) && isStr(d.at) && Array.isArray(d.items),
    )
    return list.filter((d) => !docPath || d.docPath === docPath).sort((a, b) => b.at.localeCompare(a.at))
}

export async function deliver(dir: string, input: DeliverInput, outDir: string, build: Builders): Promise<DeliveryRecord> {
    if (!input.items.length) throw new Error('納品するものを選んでください')
    const source = await g.readAt(dir, input.oid, input.docPath)
    if (source === null) throw new Error('選んだ版にこの文書がありません')
    const base = input.baseOid ? ((await g.readAt(dir, input.baseOid, input.docPath)) ?? '') : ''
    const title = parseLegal(source).title || input.docPath.replace(/\.md$/i, '')
    const client = input.docPath.includes('/') ? input.docPath.slice(0, input.docPath.lastIndexOf('/')) : ''
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    const folderName = safeName([stamp, client.replace(/\//g, '_'), title, '納品'].filter(Boolean).join('_'))
    let folder = join(outDir, folderName)
    for (let i = 2; fs.existsSync(folder); i++) folder = join(outDir, `${folderName}(${i})`)
    await fsp.mkdir(folder, { recursive: true })

    const cmpTitle = `${title} 新旧対照表`
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
        files: files.map((f) => f.name),
        folder,
        at: now.toISOString(),
        by: (await author(dir)).name,
    }

    const forge = await forgeOf(dir)
    if (input.publishRelease && forge) {
        record.releaseForge = forge.kind
        try {
            const tag = `納品/${input.docPath.replace(/\.md$/i, '')}/${record.id}`
            await git.annotatedTag({ fs, dir, ref: tag, object: input.oid, message: `${title} 納品（${input.to}）`, tagger: await author(dir) })
            await g.pushRef(dir, `refs/tags/${tag}`)
            const body = [
                `宛先：${input.to || '—'}`,
                input.effectiveDate ? `施行日：${input.effectiveDate}` : '',
                input.memo ? `\n${input.memo}` : '',
                `\n納品物：\n${record.files.map((f) => `- ${f}`).join('\n')}`,
            ].filter(Boolean).join('\n')
            record.releaseUrl = await forge.release(tag, `${title} 納品 ${stamp}${input.to ? `（${input.to}）` : ''}`, body, files)
        } catch (e) {
            record.releaseError = (e as Error).message
        }
    }
    await writeRecord(dir, `${RECORD.deliveries}${record.id}.json`, record)
    return record
}
