// 見本のデータを組み立てる道具。日本語と英語の見本で共通に使う
import type { IssueComment } from '@shared/api'
import { messagesOf, type Locale } from '@shared/i18n'
import { DEFAULT_PREFS } from '@shared/prefs'
import type { ReviewAction } from '@shared/review'
import { DEFAULT_KINDS, type DueEvent } from '@shared/schedule'
import { effectiveTag, MAIN, newId, newOid, type DemoIssue, type DemoRepo, type DemoState } from './state'

export const STATE_VERSION = 3

export function edit(text: string, from: string, to: string): string {
	if (!text.includes(from)) throw new Error(`見本の文書に「${from.slice(0, 30)}」がありません`)
	return text.replace(from, to)
}

export function removeArticle(text: string, heading: string): string {
	const start = text.indexOf(`### ${heading}`)
	if (start < 0) throw new Error(`見本の文書に「${heading}」の条がありません`)
	const rest = text.slice(start + 1)
	const next = rest.search(/\n#{2,3} /)
	return text.slice(0, start) + (next < 0 ? '' : rest.slice(next + 1))
}

export function insertBefore(text: string, heading: string, block: string): string {
	const at = text.indexOf(`\n${heading}`)
	if (at < 0) throw new Error(`見本の文書に「${heading}」がありません`)
	return `${text.slice(0, at + 1)}${block.trimEnd()}\n\n${text.slice(at + 1)}`
}

const DAY = 86_400_000
const startOfToday = () => {
	const d = new Date()
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}
const pad = (n: number) => String(n).padStart(2, '0')
export function day(offset: number): string {
	const d = new Date(startOfToday() + offset * DAY)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const at = (offset: number, hour = 10) => new Date(startOfToday() + offset * DAY + hour * 3_600_000).toISOString()
const seconds = (offset: number, hour = 10) => Math.floor((startOfToday() + offset * DAY + hour * 3_600_000) / 1000)

export class Repo {
	repo: DemoRepo
	// lang を渡すと、期日の種類の名前をその言語で固める（渡さなければ今の画面の言語）
	constructor(dir: string, name: string, note = '', lang?: Locale) {
		const labels = lang ? messagesOf(lang).labels.kinds : undefined
		this.repo = {
			dir,
			name,
			note,
			commits: {},
			branches: {},
			current: MAIN,
			work: {},
			tags: {},
			kinds: DEFAULT_KINDS.map((k) => ({ ...k, ...(labels ? { label: labels[k.id as keyof typeof labels] ?? k.label } : {}) })),
			events: [],
			issues: [],
			branchIssues: {},
			reviews: [],
			deliveries: [],
		}
	}

	commit(
		branch: string,
		files: Record<string, string>,
		message: string,
		author: string,
		offset: number,
		opts: { from?: string; hour?: number } = {},
	): string {
		const parent = this.repo.branches[branch] ?? opts.from
		const oid = newOid()
		this.repo.commits[oid] = { oid, parents: parent ? [parent] : [], message, author, timestamp: seconds(offset, opts.hour ?? 10), files: { ...files } }
		this.repo.branches[branch] = oid
		return oid
	}

	effective(docPath: string, date: string, oid: string) {
		this.repo.tags[effectiveTag(docPath, date)] = oid
	}

	event(e: Partial<DueEvent> & Pick<DueEvent, 'kind' | 'docPath' | 'date'>, by: string) {
		const stamp = at(-30)
		this.repo.events.push({ id: newId(), done: [], by, at: stamp, updatedAt: stamp, ...e })
	}

	issue(
		n: number,
		title: string,
		body: string,
		author: string,
		offset: number,
		opts: { comments?: [string, string, number][]; closed?: { oid: string; by: string; offset: number }; links?: string[] } = {},
	) {
		const comments: IssueComment[] = (opts.comments ?? []).map(([by, text, o]) => ({ id: newId(), body: text, by, at: at(o, 15), kind: 'user' }))
		const links = (opts.links ?? []).map((oid) => ({ oid, at: at(offset + 1), by: author }))
		for (const l of links) comments.push({ id: newId(), body: '', by: l.by, at: l.at, kind: 'link', oid: l.oid })
		if (opts.closed) comments.push({ id: newId(), body: '', by: opts.closed.by, at: at(opts.closed.offset), kind: 'close', oid: opts.closed.oid })
		comments.sort((a, b) => a.at.localeCompare(b.at))
		const issue: DemoIssue = {
			n,
			title,
			body,
			state: opts.closed ? 'closed' : 'open',
			author,
			createdAt: at(offset, 9),
			closedAt: opts.closed ? at(opts.closed.offset) : undefined,
			closedBy: opts.closed?.oid,
			links,
			source: 'local',
			comments,
		}
		this.repo.issues.push(issue)
	}

	review(branch: string, action: ReviewAction, by: string, text: string, offset: number, oid = this.repo.branches[branch]) {
		this.repo.reviews.push({ id: newId(), branch, action, oid, by, at: at(offset, 16), text, source: 'app' })
	}
}

// リポジトリの一覧から、デモの状態（設定・最近の文書を含む）を作る
export function buildState(repos: DemoRepo[], section: Record<string, string>, user: string): DemoState {
	const first = repos[0]
	return {
		version: STATE_VERSION,
		repos,
		settings: {
			repos: repos.map((r) => ({ name: r.name, dir: r.dir, section: section[r.dir] })),
			current: first.dir,
			author: { name: user, email: '' },
			username: '',
			prefs: {
				...DEFAULT_PREFS,
				syncOnStart: false,
				pushOnSave: false,
				notifyDue: false,
				checkUpdateOnStart: false,
				reopenLastDoc: true,
				lastDoc: { dir: first.dir, path: Object.keys(first.commits[first.branches[MAIN]].files)[0] },
				recentDocs: repos.slice(0, 5).map((r, i) => {
					const path = Object.keys(r.commits[r.branches[MAIN]].files)[0]
					return { dir: r.dir, path, title: path.replace(/\.md$/i, ''), at: Date.now() - i * 3_600_000 * 7 }
				}),
			},
		},
	}
}
