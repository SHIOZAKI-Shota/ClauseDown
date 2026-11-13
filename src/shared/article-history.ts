import { alignUnits, units, type Unit } from './article-diff'
import { parseLegal, type LegalDoc } from './legal-parser'

export interface HistEvent {
    step: number
    kind: 'enacted' | 'added' | 'changed'
}

export interface ArticleTrail {
    events: HistEvent[]
    pending: boolean
}

export type TracedUnit = Unit & { events: HistEvent[] }

const articleUnits = (src: string | LegalDoc) => units(typeof src === 'string' ? parseLegal(src) : src).filter((u) => u.kind === 'article')

export function stepUnits(sources: string[]): TracedUnit[] {
    let prev: TracedUnit[] = []
    sources.forEach((src, step) => {
        const next: TracedUnit[] = []
        for (const p of alignUnits(prev, articleUnits(src))) {
            if (!p.new) continue
            const old = p.old as TracedUnit | undefined
            const events = old ? [...old.events] : []
            if (!old) events.push({ step, kind: step === 0 ? 'enacted' : 'added' })
            else if (old.body !== p.new.body) events.push({ step, kind: 'changed' })
            next.push({ ...p.new, events })
        }
        prev = next
    })
    return prev
}

export function trailsFor(last: TracedUnit[] | null, current: string | LegalDoc): Map<number, ArticleTrail> {
    const out = new Map<number, ArticleTrail>()
    for (const p of alignUnits(last ?? [], articleUnits(current))) {
        if (!p.new || p.new.line < 0) continue
        const old = p.old as TracedUnit | undefined
        out.set(p.new.line, { events: old?.events ?? [], pending: !old || old.body !== p.new.body })
    }
    return out
}
