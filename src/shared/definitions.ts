import { parseLegal } from './legal-parser'

export interface Definition {
    term: string
    from: number
    to: number
    sentenceFrom: number
    kind: 'hereinafter' | 'means'
}

export interface DefinitionIssue {
    from: number
    to: number
    line: number
    message: string
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ')

function maskIgnored(source: string): string {
    let out = source
    const hide = (re: RegExp) => {
        out = out.replace(re, blank)
    }
    hide(/^---\n[\s\S]*?\n---(?=\n|$)/)
    hide(/<!--[\s\S]*?-->/g)
    hide(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*$/gm)
    hide(/\[\[[^\]\n]*\]\]/g)
    hide(/\{[^{}\n]*\}/g)
    const title = /^# [^\n]*/m.exec(out)
    if (title) out = out.slice(0, title.index) + blank(title[0]) + out.slice(title.index + title[0].length)
    return out
}

function sentenceStart(text: string, at: number): number {
    for (let i = at - 1; i >= 0; i--) if (text[i] === '。' || text[i] === '\n') return i + 1
    return 0
}

export function findDefinitions(source: string): Definition[] {
    const text = maskIgnored(source.replace(/\r\n?/g, '\n'))
    const out: Definition[] = []
    for (const m of text.matchAll(/以下(?:単に|これらを|これを|単にこれらを)?(「[^（）\n]*?」)(?:という|と総称する)。?）/g)) {
        const inner = m.index! + m[0].indexOf(m[1])
        for (const q of m[1].matchAll(/「([^「」\n]+)」/g)) {
            const from = inner + q.index! + 1
            out.push({ term: q[1], from, to: from + q[1].length, sentenceFrom: sentenceStart(text, m.index!), kind: 'hereinafter' })
        }
    }
    for (const m of text.matchAll(/「([^「」\n]+)」とは、/g)) {
        const from = m.index! + 1
        out.push({ term: m[1], from, to: from + m[1].length, sentenceFrom: sentenceStart(text, m.index!), kind: 'means' })
    }
    return out.sort((a, b) => a.from - b.from)
}

const COMPOUND = [/[\p{Script=Han}々〆]/u, /[\p{Script=Katakana}ー]/u]
function partOfCompound(text: string, at: number, term: string): boolean {
    if (at === 0) return false
    const prev = text[at - 1]
    return COMPOUND.some((re) => re.test(term[0]) && re.test(prev))
}

function scopes(source: string, starts: number[]): [number, number][] {
    const cuts = parseLegal(source)
        .chapters.filter((c) => c.line >= 0 && (c.kind === 'supplement' || c.kind === 'appendix' || /^附\s*則/.test(c.title)))
        .map((c) => starts[c.line] ?? source.length)
    const bounds = [0, ...cuts, source.length]
    return bounds.slice(0, -1).map((b, i) => [b, bounds[i + 1]] as [number, number]).filter(([a, b]) => b > a)
}

function occurrences(text: string, term: string): number[] {
    const out: number[] = []
    for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + term.length)) out.push(i)
    return out
}

export function checkDefinitions(input: string): DefinitionIssue[] {
    const source = input.replace(/\r\n?/g, '\n')
    const defs = findDefinitions(source)
    if (!defs.length) return []
    const starts = [0]
    for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1)
    const lineOf = (index: number) => {
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= index) lo = mid
            else hi = mid - 1
        }
        return lo + 1
    }

    let base = maskIgnored(source)
    for (const d of defs) base = base.slice(0, d.from) + blank(d.term) + base.slice(d.to)

    const out: DefinitionIssue[] = []
    for (const [from, to] of scopes(source, starts)) {
        const inScope = defs.filter((d) => d.from >= from && d.from < to)
        const first = new Map<string, Definition>()
        for (const d of inScope) {
            const prev = first.get(d.term)
            if (prev) out.push({ from: d.from, to: d.to, line: lineOf(d.from), message: `「${d.term}」は${lineOf(prev.from)}行目ですでに定義しています` })
            else first.set(d.term, d)
        }
        const terms = [...first.keys()].sort((a, b) => b.length - a.length)
        for (const term of terms) {
            const def = first.get(term)!
            let text = base.slice(0, to)
            for (const longer of terms) {
                if (longer.length <= term.length || !longer.includes(term)) continue
                text = text.replaceAll(longer, blank(longer))
            }
            const uses = occurrences(text, term).filter((i) => i >= from && !partOfCompound(text, i, term) && !(i >= def.sentenceFrom && i < def.from))
            if (!uses.length) {
                out.push({ from: def.from, to: def.to, line: lineOf(def.from), message: `「${term}」を定義していますが、使っていません` })
                continue
            }
            if (def.kind !== 'hereinafter') continue
            for (const i of uses) {
                if (i >= def.from) break
                if (source[starts[lineOf(i) - 1]] === '#') continue
                out.push({ from: i, to: i + term.length, line: lineOf(i), message: `「${term}」は${lineOf(def.from)}行目で定義しています。定義より前で使っています` })
            }
        }
    }
    return out.sort((a, b) => a.from - b.from)
}
