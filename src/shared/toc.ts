import type { Article, LegalDoc } from './legal-parser'
import { articleTitle, chapterHeading, docStyle } from './legal-parser'
import type { DocLang } from './legal-styles'

export interface TocEntry {
	key: string
	line: number
	kind: 'chapter' | 'article'
	label: string
	title: string
	text: string
	anchor: string
	deleted?: boolean
	article?: Article
}

const TOC_NAMES: Record<DocLang, string> = { ja: '目次', en: 'Contents', de: 'Inhaltsverzeichnis', fr: 'Table des matières' }

export const tocName = (lang: DocLang | undefined): string => TOC_NAMES[lang ?? 'ja'] ?? TOC_NAMES.ja

export function tocEntries(doc: LegalDoc): TocEntry[] {
	const out: TocEntry[] = []
	const latin = (doc.styleId ?? 'ja') !== 'ja'
	const style = docStyle(doc)
	let n = 0
	doc.chapters.forEach((ch, ci) => {
		if (ch.kind === 'closing') return
		const head = chapterHeading(ch, doc)
		if (head && ch.line >= 0)
			out.push({
				key: `c${ci}`,
				line: ch.line,
				kind: 'chapter',
				label: ch.label || head,
				title: ch.label ? ch.title : '',
				text: head,
				anchor: `toc-c${ci}`,
			})
		for (const a of ch.articles) {
			const key = `a${n++}`
			const title = articleTitle(a, doc)
			const label = latin ? style.headLabel(a.label) : a.label
			const text = !title ? label : latin ? `${label} ${title}` : `${label}（${title}）`
			out.push({
				key,
				line: a.line,
				kind: 'article',
				label: a.label,
				title,
				text,
				anchor: a.id ? `art-${a.id}` : `toc-${key}`,
				deleted: a.deleted,
				article: a,
			})
		}
	})
	return out
}

export interface TocSpot {
	page: number
	y: number
}

export function tocPagesFrom(entries: TocEntry[], spots: Map<number, TocSpot>, firstPage = 1): Map<string, number> {
	const out = new Map<string, number>()
	for (const e of entries) {
		const s = spots.get(e.line)
		if (s) out.set(e.key, s.page + firstPage)
	}
	return out
}

export function titleEndLine(source: string): number {
	const lines = source.split(/\r?\n/)
	let i = lines.findIndex((l) => /^#\s/.test(l))
	if (i < 0) return -1
	let j = i + 1
	while (j < lines.length && !lines[j].trim()) j++
	if (/^\s*<!--\s*clausedown\b/.test(lines[j] ?? '')) {
		while (j < lines.length && !lines[j].includes('-->')) j++
		i = j
	}
	return i
}
