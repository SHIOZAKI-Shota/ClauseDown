import { fromTagPath } from '@shared/tag-path'
import type {
	Api,
	BranchInfo,
	CommitInfo,
	Conflict,
	DocFile,
	EffectiveVersion,
	Issue,
	IssueDetail,
	IssueVersion,
	MergePreview,
	SaveVersionInput,
} from '@shared/api'
import { newDocText } from '@shared/doc-preset'
import { issueRefs } from '@shared/issue-refs'
import { autoMerge } from '@shared/merge3'
import { DELIVERY_KIND, effectivePeriods, expand, fromEffective, kindMap, type Occurrence, type ScheduleItem } from '@shared/schedule'
import { t } from '@shared/i18n'
import { DEFAULT_SIGNING } from '@shared/signing'
import { proofreadInBrowser } from './proofread'
import { seed, STATE_VERSION } from './seed'
import {
	ancestors,
	branchLabel,
	DEMO_LANG,
	draftRef,
	effectiveTag,
	firstParentLine,
	headOf,
	LANG_PARAM,
	MAIN,
	newId,
	newOid,
	USER,
	workOf,
	type DemoRepo,
	type DemoState,
} from './state'

// 見本の言語ごとに別に保存する（サイトの言語を切り替えても、もう一方の言語の状態を消さない）
const KEY = DEMO_LANG === 'en' ? 'clausedown-demo-en' : 'clausedown-demo'
const UNAVAILABLE = () => t().demo.unavailable

function load(): DemoState {
	try {
		const raw = localStorage.getItem(KEY)
		if (raw) {
			const s = JSON.parse(raw) as DemoState
			if (s.version === STATE_VERSION) return s
		}
	} catch {}
	return seed()
}

let state = load()
const save = () => {
	try {
		localStorage.setItem(KEY, JSON.stringify(state))
	} catch {}
}

export function resetDemo() {
	state = seed()
	save()
}

function repoOf(dir: string): DemoRepo {
	const r = state.repos.find((x) => x.dir === dir)
	if (!r) throw new Error(t().demo.noRepo)
	return r
}

const nowIso = () => new Date().toISOString()
const nowSec = () => Math.floor(Date.now() / 1000)
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const titleOf = (path: string, text: string) => /^# (.+)$/m.exec(text)?.[1].trim() ?? path.replace(/^.*\//, '').replace(/\.md$/i, '')
const docsOf = (repo: DemoRepo) =>
	Object.entries(workOf(repo))
		.filter(([p]) => p.toLowerCase().endsWith('.md'))
		.map(([path, text]) => ({ path, title: titleOf(path, text) }))
		.sort((a, b) => a.path.localeCompare(b.path, 'ja'))

function setWork(repo: DemoRepo, path: string, text: string | null) {
	const files = { ...workOf(repo) }
	if (text === null) delete files[path]
	else files[path] = text
	repo.work[repo.current] = files
}

function tagsByOid(repo: DemoRepo): Map<string, string[]> {
	const m = new Map<string, string[]>()
	for (const [tag, oid] of Object.entries(repo.tags)) m.set(oid, [...(m.get(oid) ?? []), tag])
	return m
}

function allEffective(repo: DemoRepo) {
	return Object.entries(repo.tags).flatMap(([tag, oid]) => {
		const m = /^施行\/(.+)\/(\d{4}-\d{2}-\d{2})$/.exec(tag)
		const c = repo.commits[oid]
		return m && c ? [{ docPath: `${fromTagPath(m[1])}.md`, date: m[2], oid, message: c.message.split('\n')[0], tag }] : []
	})
}

function log(repo: DemoRepo, path?: string, all = false): CommitInfo[] {
	const tips = [{ name: repo.current, oid: repo.branches[repo.current] }]
	if (all) for (const [name, oid] of Object.entries(repo.branches)) if (name !== repo.current) tips.push({ name, oid })
	const graph = new Set<string>()
	for (const t of tips) for (const o of ancestors(repo, t.oid)) graph.add(o)

	const changed = (oid: string) => {
		const c = repo.commits[oid]
		const p = c.parents[0] ? repo.commits[c.parents[0]] : undefined
		return c.files[path!] !== p?.files[path!]
	}
	const shown = new Set([...graph].filter((o) => !path || changed(o)))
	const nearestShown = (oid: string | undefined): string | null => {
		for (const o of firstParentLine(repo, oid)) if (shown.has(o)) return o
		return null
	}
	const lineOf = (oid: string | undefined) => new Set(firstParentLine(repo, oid).filter((o) => shown.has(o)))
	const currentLine = lineOf(repo.branches[repo.current])
	const mainLine = lineOf(repo.branches[MAIN])
	const tipOf = new Map<string, string[]>()
	for (const t of tips) {
		const hit = nearestShown(t.oid)
		if (!hit) continue
		if (path && t.name !== MAIN && mainLine.has(hit)) continue
		tipOf.set(hit, [...new Set([...(tipOf.get(hit) ?? []), branchLabel(t.name)])])
	}
	const linesOf = new Map<string, string[]>()
	for (const t of tips) for (const o of lineOf(t.oid)) linesOf.set(o, [...new Set([...(linesOf.get(o) ?? []), t.name])])
	const headShown = nearestShown(repo.branches[repo.current])
	const tags = tagsByOid(repo)
	const shownParents = (oid: string) => {
		const out: string[] = []
		for (const p of repo.commits[oid].parents) {
			const hit = nearestShown(p)
			if (hit && !out.includes(hit)) out.push(hit)
		}
		return out
	}
	return [...shown]
		.map((oid): CommitInfo => {
			const c = repo.commits[oid]
			return {
				oid,
				parents: path ? shownParents(oid) : c.parents,
				message: c.message,
				author: c.author,
				timestamp: c.timestamp,
				tags: tags.get(oid) ?? [],
				branches: tipOf.get(oid) ?? [],
				head: oid === headShown,
				onCurrent: currentLine.has(oid),
				onMain: mainLine.has(oid),
				lines: linesOf.get(oid) ?? [],
			}
		})
		.sort((a, b) => b.timestamp - a.timestamp)
}

function addCommit(repo: DemoRepo, branch: string, files: Record<string, string>, message: string, parents: string[]): string {
	const oid = newOid()
	repo.commits[oid] = { oid, parents, message, author: USER, timestamp: nowSec(), files: { ...files } }
	repo.branches[branch] = oid
	return oid
}

function closeByMessage(repo: DemoRepo, branch: string, oid: string, message: string) {
	if (branch !== MAIN) return
	for (const n of issueRefs(message).closes) {
		const issue = repo.issues.find((i) => i.n === n)
		if (!issue || issue.state === 'closed') continue
		issue.state = 'closed'
		issue.closedAt = nowIso()
		issue.closedBy = oid
		issue.comments.push({ id: newId(), body: '', by: USER, at: nowIso(), kind: 'close', oid })
	}
}

function analyze(repo: DemoRepo, into: string, from: string) {
	const intoOid = repo.branches[into]
	const fromOid = repo.branches[from]
	const intoAnc = ancestors(repo, intoOid)
	const base = [...ancestors(repo, fromOid)].filter((o) => intoAnc.has(o)).sort((a, b) => repo.commits[b].timestamp - repo.commits[a].timestamp)[0]
	const baseFiles = base ? repo.commits[base].files : {}
	const ours = repo.commits[intoOid].files
	const theirs = repo.commits[fromOid].files
	const paths = [...new Set([...Object.keys(baseFiles), ...Object.keys(ours), ...Object.keys(theirs)])]
	const merged: Record<string, string> = { ...ours }
	const conflicts: Conflict[] = []
	const autoMerged: string[] = []
	const files: string[] = []
	for (const p of paths) {
		const b = baseFiles[p] ?? ''
		const o = ours[p]
		const t = theirs[p]
		if (t === o || t === baseFiles[p]) continue
		files.push(p)
		if (o === baseFiles[p]) {
			if (t === undefined) delete merged[p]
			else merged[p] = t
			continue
		}
		const m = o !== undefined && t !== undefined ? autoMerge(b, o, t) : null
		if (m !== null) {
			merged[p] = m
			autoMerged.push(p)
		} else conflicts.push({ path: p, base: b, ours: o ?? '', theirs: t ?? '', oursDeleted: o === undefined })
	}
	return { upToDate: intoAnc.has(fromOid), merged, conflicts, autoMerged, files, fromOid, intoOid }
}

function occurrencesOf(repo: DemoRepo, from: string, to: string, today: string) {
	const tags = allEffective(repo)
	const items: Occurrence[] = expand(repo.events, repo.kinds, from, to, today)
	items.push(
		...fromEffective(
			tags.filter((t) => t.date >= from && t.date <= to),
			repo.kinds,
		),
	)
	const k = kindMap(repo.kinds)(DELIVERY_KIND)
	for (const d of repo.deliveries) {
		const date = ymd(new Date(d.at))
		if (date < from || date > to) continue
		items.push({
			key: `delivery:${d.id}`,
			source: 'delivery',
			id: d.id,
			kind: DELIVERY_KIND,
			title: `${d.title}${d.to ? ` → ${d.to}` : ''}`,
			docPath: d.docPath,
			date,
			task: false,
			done: false,
			overdue: false,
			repeat: false,
			remind: k.remind,
			oid: d.oid,
		})
	}
	return {
		kinds: repo.kinds,
		events: repo.events.filter((e) => !e.deleted),
		items: items.sort((a, b) => a.date.localeCompare(b.date)),
		periods: effectivePeriods(tags),
	}
}

const toItem = (repo: DemoRepo, o: Occurrence): ScheduleItem => {
	const k = kindMap(repo.kinds)(o.kind)
	return { ...o, key: `${repo.dir}|${o.key}`, dir: repo.dir, repo: repo.name, kindLabel: k.label, color: k.color }
}

const issueOf = (repo: DemoRepo, n: number) => {
	const i = repo.issues.find((x) => x.n === n)
	if (!i) throw new Error(t().demo.issueNotFound(n))
	return i
}
const plainIssue = ({ comments: _c, ...i }: DemoRepo['issues'][number]): Issue => structuredClone(i)

function siteTheme(): 'light' | 'dark' | undefined {
	try {
		const t = localStorage.getItem('clausedown-site-theme')
		return t === 'light' || t === 'dark' ? t : undefined
	} catch {
		return undefined
	}
}

const unavailable = () => Promise.reject(new Error(UNAVAILABLE()))
const noop = () => () => {}
const mutate =
	<A extends unknown[], R>(fn: (...a: A) => R) =>
	async (...a: A): Promise<R> => {
		const r = fn(...a)
		save()
		return r
	}

type DemoUnsupported =
	| 'resetAll'
	| 'suggestVersionMessage'
	| 'duplicateRepo'
	| 'forkRepo'
	| 'createSamples'
	| 'detectHouritsu'
	| 'convertHouritsu'
	| 'hasToken'
	| 'setToken'
	| 'pickFolder'
	| 'pickFolders'
	| 'cloneRepo'
	| 'publishRepo'
	| 'changeRemote'
	| 'disconnectRemote'
	| 'initRepo'
	| 'moveDoc'
	| 'copyDocToRepo'
	| 'showDocInFolder'
	| 'resolveConflicts'
	| 'exportFile'
	| 'previewPdf'
	| 'setSigningPrefs'
	| 'generateSigningKey'
	| 'deleteSigningKey'
	| 'registerSigningKey'
	| 'testExternalSigning'
	| 'importPdfCert'
	| 'createSelfSignedCert'
	| 'addMynaCert'
	| 'updatePdfCert'
	| 'removePdfCert'
	| 'setDefaultPdfCert'
	| 'setRepoPdfCert'
	| 'exportPdfCert'
	| 'setTsaPassword'
	| 'testTimestamp'
	| 'publishSigningKey'
	| 'listSeals'
	| 'saveSeal'
	| 'readSeal'
	| 'deleteSeal'
	| 'policyStatus'
	| 'signLegacyRules'
	| 'proposePolicy'
	| 'cosignPolicy'
	| 'acceptGenesisChange'
	| 'forgePublicKeys'
	| 'pickReceivedPdf'
	| 'saveReceivedPdf'
	| 'exportAllowedSigners'
	| 'verifyMd'
	| 'trustMdKey'
	| 'addMdKey'
	| 'removeMdKey'
	| 'setMdSigning'
	| 'exportCdsign'
	| 'pickCdsign'
	| 'saveCdsign'
	| 'saveImage'
	| 'moveIssuesToForge'
	| 'setSpellLanguages'
	| 'downloadUpdate'
	| 'installUpdate'
	| 'saveRules'
	| 'exportSchedule'
	| 'deliver'
	| 'openPath'
	| 'openExported'
	| 'showExported'
	| 'loginStart'
	| 'loginWait'
	| 'logout'
	| 'aiStatus'
	| 'setAiKey'
	| 'setAiConfig'
	| 'listAiModels'
	| 'aiLoginOpenRouter'
	| 'testAi'
	| 'getMcpToken'
	| 'regenerateMcpToken'
	| 'setMcp'
	| 'desktopStatus'
	| 'registerDesktop'
	| 'unregisterDesktop'
	| 'aiRun'
	| 'aiStop'
	| 'aiReset'

const impl: Omit<Api, DemoUnsupported> = {
	getSettings: async () => ({ ...structuredClone(state.settings), theme: state.settings.theme ?? siteTheme() }),
	saveSettings: mutate((s) => {
		state.settings = structuredClone(s)
	}),
	setTheme: mutate((theme) => {
		state.settings.theme = theme
		if (window.parent !== window) window.parent.postMessage({ type: 'clausedown-theme', theme }, location.origin)
	}),
	platform: async () => 'web',
	systemLanguages: async () => (LANG_PARAM ? [LANG_PARAM] : [...navigator.languages]),
	listFonts: async () => [],
	setZoom: async () => {},
	repoStatus: async (dirs) => Object.fromEntries(dirs.map((d) => [d, state.repos.some((r) => r.dir === d) ? 'ok' : 'missing'])),
	openRepo: async (dir) => (state.repos.some((r) => r.dir === dir) ? { ok: true } : { ok: false, message: UNAVAILABLE() }),
	accounts: async () => [],
	identity: async () => ({ name: USER, email: '', source: 'manual', label: t().demo.badge }),
	getLicenses: async () => null,
	forgeKind: async () => null,
	getRules: async () => ({ requireApproval: false, approvers: [] }),
	signingStatus: async () => ({ signing: structuredClone(DEFAULT_SIGNING), hasKey: false, external: null, myna: false, chip: false, hasTsaPassword: false }),
	mynaStatus: async () => ({ available: false, reader: null, card: false, signCert: false, retries: null }),
	verifyCommits: async (_dir, oids) => Object.fromEntries(oids.map((o) => [o, { state: 'none' as const }])),
	listFolderStyles: async () => ({}),
	saveFolderStyle: async () => true,

	listDocs: async (dir) => {
		const repo = repoOf(dir)
		const head = headOf(repo)?.files ?? {}
		return docsOf(repo).map((d): DocFile => ({ ...d, changed: head[d.path] !== workOf(repo)[d.path] }))
	},
	readDoc: async (dir, path) => {
		const text = workOf(repoOf(dir))[path]
		if (text === undefined) throw new Error(t().demo.notFound(path))
		return text
	},
	writeDoc: mutate((dir, path, content) => setWork(repoOf(dir), path, content)),
	createDoc: mutate((dir, path, title, preset) => {
		const repo = repoOf(dir)
		if (workOf(repo)[path] !== undefined) throw new Error(t().errors.git.docExists)
		setWork(repo, path, newDocText(title, preset))
	}),
	deleteDoc: mutate((dir, path) => {
		setWork(repoOf(dir), path, null)
		return { recorded: false }
	}),
	copyDoc: mutate((dir, path) => {
		const repo = repoOf(dir)
		const files = workOf(repo)
		let i = 2
		let to = path.replace(/\.md$/i, ` (${i}).md`)
		while (files[to] !== undefined) to = path.replace(/\.md$/i, ` (${++i}).md`)
		setWork(repo, to, files[path] ?? '')
		return to
	}),
	discardChanges: mutate((dir, path) => {
		const repo = repoOf(dir)
		setWork(repo, path, headOf(repo)?.files[path] ?? null)
	}),
	readRepoNote: async (dir) => repoOf(dir).note,
	saveRepoNote: mutate((dir, text) => {
		repoOf(dir).note = text
		return true
	}),
	repoActivity: async (dir) => {
		const repo = repoOf(dir)
		const commits = log(repo)
		const docs: Record<string, { articles: number; author?: string; timestamp?: number }> = {}
		for (const d of docsOf(repo)) {
			const last = commits.find((c) => {
				const v = repo.commits[c.oid]
				return v.files[d.path] !== repo.commits[v.parents[0]]?.files[d.path]
			})
			docs[d.path] = { articles: (workOf(repo)[d.path].match(/^### /gm) ?? []).length, author: last?.author, timestamp: last?.timestamp }
		}
		return {
			recent: commits
				.slice(0, 10)
				.map((c) => ({ oid: c.oid, message: c.message, author: c.author, timestamp: c.timestamp, paths: Object.keys(repo.commits[c.oid].files) })),
			docs,
			effective: allEffective(repo).map(({ docPath, date, oid, message }) => ({ docPath, date, oid, message })),
		}
	},

	log: async (dir, path, all) => log(repoOf(dir), path, all),
	lastChange: async (dir, path) => {
		const c = log(repoOf(dir), path)[0]
		return c ? { oid: c.oid, message: c.message, author: c.author, timestamp: c.timestamp } : null
	},
	readAt: async (dir, oid, path) => repoOf(dir).commits[oid]?.files[path] ?? null,
	saveVersion: mutate((dir, input: SaveVersionInput) => {
		const repo = repoOf(dir)
		const message = input.message.trim() || t().demo.defaultMessage
		const oid = addCommit(repo, repo.current, workOf(repo), message, [repo.branches[repo.current]])
		delete repo.work[repo.current]
		if (input.effectiveDate && input.docPath) repo.tags[effectiveTag(input.docPath, input.effectiveDate)] = oid
		closeByMessage(repo, repo.current, oid, message)
		return oid
	}),

	listBranches: async (dir) => {
		const repo = repoOf(dir)
		const mainOid = repo.branches[MAIN]
		const mainAnc = ancestors(repo, mainOid)
		return Object.entries(repo.branches)
			.map(([name, oid]): BranchInfo => {
				const c = repo.commits[oid]
				const isMain = name === MAIN
				const mine = ancestors(repo, oid)
				return {
					name,
					label: branchLabel(name),
					isMain,
					current: name === repo.current,
					local: true,
					remote: false,
					oid,
					timestamp: c.timestamp,
					author: c.author,
					changes: isMain ? 0 : [...mine].filter((o) => !mainAnc.has(o)).length,
					mainMoved: !isMain && !mine.has(mainOid),
				}
			})
			.sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : b.timestamp - a.timestamp))
	},
	createBranch: mutate((dir, label, from) => {
		const repo = repoOf(dir)
		const name = draftRef(label)
		if (repo.branches[name]) throw new Error(t().demo.draftExists(label))
		const source = from ?? repo.current
		repo.branches[name] = repo.branches[source]
		if (source === repo.current && repo.work[repo.current]) {
			repo.work[name] = repo.work[repo.current]
			delete repo.work[repo.current]
		}
		repo.current = name
		return name
	}),
	switchBranch: mutate((dir, name) => {
		const repo = repoOf(dir)
		if (!repo.branches[name]) throw new Error(t().demo.draftNotFound(branchLabel(name)))
		repo.current = name
	}),
	deleteBranch: mutate((dir, name) => {
		const repo = repoOf(dir)
		if (name === MAIN) throw new Error(t().demo.mainUndeletable)
		if (repo.current === name) repo.current = MAIN
		delete repo.branches[name]
		delete repo.work[name]
		delete repo.branchIssues[name]
	}),
	previewMerge: async (dir, from, into): Promise<MergePreview> => {
		const a = analyze(repoOf(dir), into, from)
		return { upToDate: a.upToDate, files: a.files, conflicts: a.conflicts, autoMerged: a.autoMerged, from: a.fromOid }
	},
	mergeBranch: mutate((dir, input) => {
		const repo = repoOf(dir)
		const a = analyze(repo, input.into, input.from)
		const files = { ...a.merged }
		for (const c of a.conflicts) {
			const choice = input.choices[c.path]
			const text = choice === 'ours' ? c.ours : choice === 'theirs' ? c.theirs : choice?.content
			if (text === undefined) throw new Error(t().demo.pickConflict(c.path))
			if (text === null) delete files[c.path]
			else files[c.path] = text
		}
		const oid = addCommit(repo, input.into, files, input.message, [a.intoOid, a.fromOid])
		repo.current = input.into
		delete repo.work[input.into]
		if (input.effectiveDate) {
			const docs = a.files.filter((p) => p.toLowerCase().endsWith('.md'))
			for (const p of docs.length ? docs : ['all']) repo.tags[effectiveTag(p, input.effectiveDate)] = oid
		}
		closeByMessage(repo, input.into, oid, input.message)
		if (input.deleteAfter) {
			delete repo.branches[input.from]
			delete repo.branchIssues[input.from]
		}
		return { state: 'local' as const }
	}),
	sync: async () => ({ state: 'local' }),
	push: async () => ({ state: 'local' }),

	listEffective: async (dir, docPath) => {
		const repo = repoOf(dir)
		const out: EffectiveVersion[] = allEffective(repo)
			.filter((e) => e.docPath === docPath)
			.map((e) => {
				const c = repo.commits[e.oid]
				return { tag: e.tag, date: e.date, oid: e.oid, message: c.message.trim(), author: c.author, timestamp: c.timestamp }
			})
		return out.sort((a, b) => b.date.localeCompare(a.date))
	},
	addEffective: mutate((dir, docPath, oid, date) => {
		const repo = repoOf(dir)
		if (repo.commits[oid]?.files[docPath] === undefined) throw new Error(t().demo.notInVersion)
		repo.tags[effectiveTag(docPath, date)] = oid
	}),
	removeEffective: mutate((dir, docPath, date) => {
		delete repoOf(dir).tags[effectiveTag(docPath, date)]
	}),

	occurrences: async (dir, from, to, today) => occurrencesOf(repoOf(dir), from, to, today),
	occurrencesAll: async (from, to, today) => {
		const parts = state.repos.map((repo) => ({ repo, ...occurrencesOf(repo, from, to, today) }))
		return {
			repos: parts.map((p) => ({ dir: p.repo.dir, name: p.repo.name, kinds: p.kinds, events: p.events, docs: docsOf(p.repo) })),
			items: parts.flatMap((p) => p.items.map((o) => toItem(p.repo, o))).sort((a, b) => a.date.localeCompare(b.date)),
			periods: parts.flatMap((p) => p.periods.map((x) => ({ ...x, key: `${p.repo.dir}|${x.key}`, dir: p.repo.dir }))),
		}
	},
	scheduleAll: async (today, days = 365) => {
		const d = new Date(`${today}T00:00:00`)
		d.setDate(d.getDate() + Math.max(1, Math.min(3650, Math.trunc(days) || 365)))
		const to = ymd(d)
		return state.repos
			.flatMap((repo) => {
				const occ = [
					...expand(repo.events, repo.kinds, '1900-01-01', to, today),
					...fromEffective(
						allEffective(repo).filter((t) => t.date >= today && t.date <= to),
						repo.kinds,
					),
				].filter((o) => o.overdue || (o.end ?? o.date) >= today)
				return occ.map((o) => toItem(repo, o))
			})
			.sort((a, b) => a.date.localeCompare(b.date))
	},
	listEvents: async (dir) => repoOf(dir).events.filter((e) => !e.deleted),
	saveEvent: mutate((dir, input) => {
		const repo = repoOf(dir)
		const old = input.id ? repo.events.find((e) => e.id === input.id) : undefined
		const stamp = nowIso()
		const e = { done: [], by: USER, at: stamp, ...old, ...input, id: old?.id ?? newId(), updatedAt: stamp }
		repo.events = [...repo.events.filter((x) => x.id !== e.id), e]
		return e
	}),
	deleteEvent: mutate((dir, id) => {
		const repo = repoOf(dir)
		repo.events = repo.events.filter((e) => e.id !== id)
	}),
	setEventDone: mutate((dir, id, date, done) => {
		const e = repoOf(dir).events.find((x) => x.id === id)
		if (!e) throw new Error(t().demo.dueNotFound)
		e.done = done ? [...new Set([...e.done, date])] : e.done.filter((d) => d !== date)
		e.updatedAt = nowIso()
	}),
	getEventKinds: async (dir) => repoOf(dir).kinds,
	saveEventKinds: mutate((dir, kinds) => {
		repoOf(dir).kinds = kinds
	}),
	listDeliveries: async (dir, docPath) => repoOf(dir).deliveries.filter((d) => !docPath || d.docPath === docPath),

	listIssues: async (dir) => repoOf(dir).issues.map(plainIssue),
	issueDetail: async (dir, n): Promise<IssueDetail> => {
		const repo = repoOf(dir)
		const issue = issueOf(repo, n)
		const how = new Map<string, IssueVersion['how']>()
		const rank = { ref: 0, link: 1, close: 2 } as const
		const put = (oid: string, h: IssueVersion['how']) => {
			const cur = how.get(oid)
			if (!cur || rank[h] > rank[cur]) how.set(oid, h)
		}
		for (const l of issue.links) put(l.oid, 'link')
		if (issue.closedBy) put(issue.closedBy, 'close')
		for (const c of Object.values(repo.commits)) {
			const r = issueRefs(c.message)
			if (r.closes.includes(n)) put(c.oid, 'close')
			else if (r.refs.includes(n)) put(c.oid, 'ref')
		}
		const versions = [...how]
			.filter(([oid]) => repo.commits[oid])
			.map(([oid, h]) => ({ oid, message: repo.commits[oid].message, at: repo.commits[oid].timestamp, how: h }))
			.sort((a, b) => b.at - a.at)
		const drafts = Object.entries(repo.branchIssues)
			.filter(([b, ns]) => repo.branches[b] && ns.includes(n))
			.map(([b]) => b)
		return { ...plainIssue(issue), versions, drafts, comments: structuredClone(issue.comments) }
	},
	createIssue: mutate((dir, input) => {
		const repo = repoOf(dir)
		if (!input.title.trim()) throw new Error(t().demo.titleRequired)
		const n = Math.max(0, ...repo.issues.map((i) => i.n)) + 1
		const issue = {
			n,
			title: input.title.trim(),
			body: input.body,
			state: 'open' as const,
			author: USER,
			createdAt: nowIso(),
			links: [],
			source: 'local' as const,
			comments: [],
		}
		repo.issues.push(issue)
		return plainIssue(issue)
	}),
	updateIssue: mutate((dir, n, patch) => {
		const issue = issueOf(repoOf(dir), n)
		Object.assign(issue, patch)
		return plainIssue(issue)
	}),
	commentIssue: mutate((dir, n, body) => {
		if (!body.trim()) throw new Error(t().demo.commentRequired)
		issueOf(repoOf(dir), n).comments.push({ id: newId(), body, by: USER, at: nowIso(), kind: 'user' })
	}),
	closeIssue: mutate((dir, n, oid) => {
		const issue = issueOf(repoOf(dir), n)
		issue.state = issue.state === 'open' ? 'closed' : 'open'
		issue.closedAt = issue.state === 'closed' ? nowIso() : undefined
		issue.closedBy = issue.state === 'closed' ? oid : undefined
		if (issue.state === 'closed') issue.comments.push({ id: newId(), body: '', by: USER, at: nowIso(), kind: 'close', oid })
		return plainIssue(issue)
	}),
	linkIssue: mutate((dir, n, oid) => {
		const issue = issueOf(repoOf(dir), n)
		if (!issue.links.some((l) => l.oid === oid)) issue.links.push({ oid, at: nowIso(), by: USER })
		issue.comments.push({ id: newId(), body: '', by: USER, at: nowIso(), kind: 'link', oid })
	}),
	branchIssues: async (dir, branch) => repoOf(dir).branchIssues[branch] ?? [],
	setBranchIssues: mutate((dir, branch, issues) => {
		repoOf(dir).branchIssues[branch] = issues
	}),
	pendingLocalIssues: async () => 0,

	listReviews: async (dir) => structuredClone(repoOf(dir).reviews),
	addReview: mutate((dir, input) => {
		const repo = repoOf(dir)
		repo.reviews.push({
			id: newId(),
			branch: input.branch,
			action: input.action,
			oid: repo.branches[input.branch],
			by: USER,
			at: nowIso(),
			text: input.text,
			source: 'app',
		})
	}),

	proofread: (text) => proofreadInBrowser(text, state.settings.prefs),
	openExternal: async (url) => {
		window.open(url, '_blank', 'noopener')
	},
	editCommand: async (cmd) => {
		document.execCommand(cmd)
	},
	updateState: async () => ({ state: 'dev', current: t().demo.badge }),
	checkUpdate: async () => ({ state: 'dev', current: t().demo.badge }),
	onDocChanged: noop,
	onAiEvent: noop,
	onOpenSchedule: noop,
	onUpdateState: noop,
}

export function createDemoApi(): Api {
	return new Proxy(impl as Api, {
		get(target, key) {
			if (key in target) return target[key as keyof Api]
			return typeof key === 'string' && key !== 'then' ? unavailable : undefined
		},
	})
}
