export interface IssueRefs {
    refs: number[]
    closes: number[]
}

const REF_RE = /(^|[^\w&#/])#(\d+)\b/g
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+#(\d+)\b/gi

export function issueRefs(message: string): IssueRefs {
    const refs = new Set<number>()
    const closes = new Set<number>()
    for (const m of message.matchAll(REF_RE)) refs.add(Number(m[2]))
    for (const m of message.matchAll(CLOSE_RE)) closes.add(Number(m[1]))
    return { refs: [...refs].sort((a, b) => a - b), closes: [...closes].sort((a, b) => a - b) }
}

export const closeLine = (n: number) => `Closes #${n}`
export const refLine = (n: number) => `Refs #${n}`

export function withIssueLines(message: string, close: number[], ref: number[]): string {
    const have = issueRefs(message)
    const lines = [
        ...close.filter((n) => !have.closes.includes(n)).map(closeLine),
        ...ref.filter((n) => !have.refs.includes(n) && !close.includes(n)).map(refLine),
    ]
    return lines.length ? `${message.replace(/\s+$/, '')}\n\n${lines.join('\n')}` : message
}

export function splitIssueRefs(text: string): (string | number)[] {
    const out: (string | number)[] = []
    let last = 0
    for (const m of text.matchAll(REF_RE)) {
        const at = m.index! + m[1].length
        if (at > last) out.push(text.slice(last, at))
        out.push(Number(m[2]))
        last = at + 1 + m[2].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
}
