import fs from 'node:fs'
import { z } from 'zod'
import { locale, t } from '../shared/i18n'
import git from './igit'
import * as g from './git'
import { RECORDS_BRANCH, tryResolve } from './git-base'
import { loadSettings } from './settings'
import { checkDoc, numberedText } from '../shared/doc-view'
import { compareSources, type Part } from '../shared/article-diff'
import type { RepoEntry } from '../shared/api'

export interface ToolContext {
    by: 'ai' | 'mcp'
    changed(dir: string, path: string): void
    repoDir?: string
}

export interface AiTool<S extends z.ZodObject = z.ZodObject> {
    name: string
    title: string
    description: string
    schema: S
    readOnly: boolean
    label(input: z.infer<S>): string
    run(input: z.infer<S>, ctx: ToolContext): Promise<string>
}

const tool = <S extends z.ZodObject>(t: AiTool<S>) => t as unknown as AiTool

const repoArg = z.string().describe('リポジトリの名前（list_repos の name）')
const pathArg = z.string().describe('リポジトリ内の文書のパス（例：契約書/業務委託契約書.md）。list_docs の path')

async function findRepo(name: string): Promise<RepoEntry> {
    const { repos } = await loadSettings()
    const hit = repos.find((r) => r.name === name) ?? repos.find((r) => r.dir === name)
    const e = t().errors.aiTools
    if (!hit) throw new Error(e.repoNotRegistered(name, repos.map((r) => r.name).join(e.listSep) || e.none))
    if (!fs.existsSync(hit.dir)) throw new Error(e.repoFolderMissing(name))
    return hit
}

const currentBranchLabel = (dir: string) => g.currentLabel(dir)

async function resolveVersion(dir: string, version: string): Promise<string> {
    const v = version.trim()
    const main = await g.mainBranch(dir)
    const remote = await git.listBranches({ fs, dir, remote: 'origin' }).catch(() => [] as string[])
    const names = [...new Set([...(await git.listBranches({ fs, dir })), ...remote])].filter((n) => n !== 'HEAD' && n !== RECORDS_BRANCH)
    // 道具の説明は「現行版」で指定させているので、画面の言語によらず受け付ける
    const name = names.find((n) => n === v || g.branchLabel(n, main) === v || (n === main && v === '現行版'))
    if (name) return g.branchOid(dir, name)
    if (/^[0-9a-f]{4,40}$/i.test(v)) {
        const oid = await git.expandOid({ fs, dir, oid: v.toLowerCase() }).catch(() => null)
        if (oid) return oid
    }
    const tag = (await tryResolve(dir, `refs/tags/${v}`)) ?? (await tryResolve(dir, v))
    if (tag) return tag
    throw new Error(t().errors.aiTools.versionNotFound(version))
}

const date = (sec: number) => new Date(sec * 1000).toLocaleDateString(locale() === 'en' ? 'en-US' : 'ja-JP')
const partsText = (parts: Part[]) => parts.map((p) => (p.changed ? `【${p.text}】` : p.text)).join('')

export const TOOLS: AiTool[] = [
    tool({
        name: 'list_repos',
        title: 'リポジトリの一覧',
        description: 'ClauseDown に登録されているリポジトリ（案件ごと・依頼主ごとなどの文書の保管先）の一覧と、今開いている改定案を返す。',
        schema: z.object({}),
        readOnly: true,
        label: () => t().notify.aiTools.labels.listRepos,
        async run(_input, ctx) {
            const { repos: all, current } = await loadSettings()
            const repos = ctx.repoDir ? all.filter((r) => r.dir === ctx.repoDir) : all
            const m = t().notify.aiTools
            if (!repos.length) return m.noRepos
            const rows = await Promise.all(
                repos.map(async (r) => {
                    const branch = fs.existsSync(r.dir) ? await currentBranchLabel(r.dir).catch(() => '?') : m.noFolder
                    return m.repoLine(r.name, r.dir === current, branch)
                }),
            )
            return rows.join('\n')
        },
    }),
    tool({
        name: 'list_docs',
        title: '文書の一覧',
        description: 'リポジトリ内の文書（.md）の一覧。changed は版を保存していない変更があるか。',
        schema: z.object({ repo: repoArg }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.listDocs(i.repo),
        async run({ repo }) {
            const r = await findRepo(repo)
            const docs = await g.listDocs(r.dir)
            const branch = await currentBranchLabel(r.dir)
            const m = t().notify.aiTools
            return [m.working(branch), ...docs.map((d) => m.docLine(d.path, d.title, !!d.changed))].join('\n')
        },
    }),
    tool({
        name: 'read_doc',
        title: '文書を読む',
        description:
            '作業フォルダの文書を読む。各行の先頭に「行番号|」と、計算した番号〔第3条第2項〕を添えて返す（これらは md には書かれていない。edit_doc では行番号と〔〕を除いた本文で指定すること）。',
        schema: z.object({ repo: repoArg, path: pathArg }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.readDoc(i.path),
        async run({ repo, path }) {
            const r = await findRepo(repo)
            return numberedText(await g.readDoc(r.dir, path))
        },
    }),
    tool({
        name: 'check_doc',
        title: '書き方のチェック',
        description: '機械的に分かる誤り（参照先のない条参照、書式設定の誤り、描けない図、本文のない条など）を返す。内容の法的な当否は見ない。',
        schema: z.object({ repo: repoArg, path: pathArg }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.checkDoc(i.path),
        async run({ repo, path }) {
            const r = await findRepo(repo)
            const issues = checkDoc(await g.readDoc(r.dir, path))
            const m = t().notify.aiTools
            if (!issues.length) return m.noIssues
            return issues.map((i) => m.issueLine(i.line ?? 0, i.severity === 'error', i.message)).join('\n')
        },
    }),
    tool({
        name: 'edit_doc',
        title: '文書の一部を書き換える',
        description:
            '作業フォルダの文書の一部を置き換える（版は保存しない。人が確認して保存する）。old_text は文書中にちょうど1回だけ現れる md の本文（read_doc の行番号と〔〕は含めない）。条の番号は自動で振られるので、見出しや本文に「第3条」と書き込まないこと。',
        schema: z.object({
            repo: repoArg,
            path: pathArg,
            old_text: z.string().min(1).describe('置き換える前の本文（文書中に1回だけ現れること）'),
            new_text: z.string().describe('置き換えた後の本文'),
        }),
        readOnly: false,
        label: (i) => t().notify.aiTools.labels.editDoc(i.path),
        async run({ repo, path, old_text, new_text }, ctx) {
            g.assertDocPath(path)
            const r = await findRepo(repo)
            const src = await g.readDoc(r.dir, path)
            const crlf = src.includes('\r\n')
            const norm = (s: string) => (crlf ? s.replace(/\r?\n/g, '\r\n') : s)
            const from = norm(old_text)
            const count = src.split(from).length - 1
            if (count === 0) throw new Error(t().errors.aiTools.oldTextMissing)
            if (count > 1) throw new Error(t().errors.aiTools.oldTextMany(count))
            await g.writeDoc(
                r.dir,
                path,
                src.replace(from, () => norm(new_text)),
            )
            ctx.changed(r.dir, path)
            return t().notify.aiTools.edited(await currentBranchLabel(r.dir))
        },
    }),
    tool({
        name: 'write_doc',
        title: '文書を丸ごと書く',
        description:
            '作業フォルダの文書を丸ごと書き換える、または新しい文書を作る（版は保存しない）。一部だけ直すときは edit_doc を使うこと。書式は ClauseDown の md（# 文書名、## 章、### 条 {#名前}、- 項、  - 号、[[名前]] で条参照）。',
        schema: z.object({ repo: repoArg, path: pathArg, content: z.string().min(1).describe('文書全体の md') }),
        readOnly: false,
        label: (i) => t().notify.aiTools.labels.writeDoc(i.path),
        async run({ repo, path, content }, ctx) {
            g.assertDocPath(path)
            const r = await findRepo(repo)
            await g.writeDoc(r.dir, path, content)
            ctx.changed(r.dir, path)
            return t().notify.aiTools.written(await currentBranchLabel(r.dir))
        },
    }),
    tool({
        name: 'list_versions',
        title: '版と施行日の一覧',
        description: 'その文書の保存済みの版（新しい順）、施行日、改定案の一覧。版 ID は read_doc_version・compare_versions で使う。',
        schema: z.object({ repo: repoArg, path: pathArg }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.listVersions(i.path),
        async run({ repo, path }) {
            const r = await findRepo(repo)
            const [log, effective, branches] = await Promise.all([g.log(r.dir, path), g.listEffective(r.dir, path), g.listBranches(r.dir)])
            const m = t().notify.aiTools
            return [
                m.drafts,
                ...branches.map((b) => `- ${b.label}${b.current ? m.currentDraft : ''}`),
                m.effectiveDates,
                ...(effective.length ? effective.map((e) => m.effectiveLine(e.date, e.oid.slice(0, 8))) : [m.none]),
                m.versions,
                ...log.slice(0, 30).map((c) => `- ${c.oid.slice(0, 8)} ${date(c.timestamp)} ${c.author}：${c.message.split('\n')[0]}`),
            ].join('\n')
        },
    }),
    tool({
        name: 'read_doc_version',
        title: '過去の版を読む',
        description: '保存済みの版の文書を読む（行番号と計算した番号を添える）。version は版 ID、改定案の名前、または「現行版」。',
        schema: z.object({ repo: repoArg, path: pathArg, version: z.string().describe('版 ID・改定案の名前・「現行版」') }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.readVersion(i.path, i.version),
        async run({ repo, path, version }) {
            const r = await findRepo(repo)
            const src = await g.readAt(r.dir, await resolveVersion(r.dir, version), path)
            if (src === null) throw new Error(t().errors.aiTools.docNotInVersion)
            return numberedText(src)
        },
    }),
    tool({
        name: 'compare_versions',
        title: '新旧を比べる',
        description:
            '2つの版を条単位で比べ、変わった条だけを返す（【】が変わった文字）。to を省くと作業フォルダの今の内容と比べる。新旧対照表の説明や、改定案のチェックに使う。',
        schema: z.object({
            repo: repoArg,
            path: pathArg,
            from: z.string().describe('改正前の版（版 ID・改定案の名前・「現行版」）'),
            to: z.string().optional().describe('改正後の版。省くと作業フォルダの今の内容'),
        }),
        readOnly: true,
        label: (i) => t().notify.aiTools.labels.compare(i.path),
        async run({ repo, path, from, to }) {
            const r = await findRepo(repo)
            const oldSrc = (await g.readAt(r.dir, await resolveVersion(r.dir, from), path)) ?? ''
            const newSrc = to ? ((await g.readAt(r.dir, await resolveVersion(r.dir, to), path)) ?? '') : await g.readDoc(r.dir, path)
            const rows = compareSources(oldSrc, newSrc).filter((x) => x.status !== 'same')
            const m = t().notify.aiTools
            if (!rows.length) return m.noDiff
            const kind = { changed: m.changed, added: m.added, removed: m.removed, same: '' }
            return rows
                .map((x) =>
                    [`### ${kind[x.status]}`, `${m.before}\n${partsText(x.oldParts) || m.empty}`, `${m.after}\n${partsText(x.newParts) || m.empty}`].join('\n'),
                )
                .join('\n\n')
        },
    }),
]

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
    const tl = TOOLS.find((x) => x.name === name)
    const e = t().errors.aiTools
    if (!tl) throw new Error(e.unknownTool(name))
    const parsed = tl.schema.safeParse(input)
    if (!parsed.success) throw new Error(e.badInput(parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(e.listSep)))
    const data = parsed.data as { repo?: unknown; path?: unknown }
    if (data.path !== undefined) g.assertDocPath(data.path)
    if (ctx.repoDir && typeof data.repo === 'string' && (await findRepo(data.repo)).dir !== ctx.repoDir) {
        throw new Error(e.openRepoOnly)
    }
    return tl.run(parsed.data, ctx)
}

export function toolLabel(name: string, input: unknown): string {
    const tl = TOOLS.find((x) => x.name === name)
    const parsed = tl?.schema.safeParse(input)
    return tl && parsed?.success ? tl.label(parsed.data) : name
}
