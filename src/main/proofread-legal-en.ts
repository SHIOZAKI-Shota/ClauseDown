// 英文契約の言い回しを確かめる校正の規則（textlint の規則の形）。
// 意味があいまいになりやすい書き方と、短く言い換えられる決まり文句を指摘する。和文には当たらない。
const SKIP = new Set(['Link', 'Image', 'BlockQuote', 'Emphasis'])

interface Phrase {
    re: RegExp
    message: (found: string) => string
    fix?: string
}

const PHRASES: Phrase[] = [
    {
        re: /\band\/or\b/gi,
        message: () => '「and/or」は範囲があいまいです。「A or B, or both」のように書き分けてください',
    },
    { re: /\bin the event that\b/gi, fix: 'if', message: (f) => `「${f}」は「if」で足ります` },
    { re: /\bprior to\b/gi, fix: 'before', message: (f) => `「${f}」は「before」で足ります` },
    { re: /\bsubsequent to\b/gi, fix: 'after', message: (f) => `「${f}」は「after」で足ります` },
    { re: /\bshall be entitled to\b/gi, fix: 'may', message: (f) => `「${f}」は「may」で足ります` },
    {
        re: /\b(?:herein|hereto|hereof|hereunder|hereinafter)\b/gi,
        message: (f) => `「${f}」は指す範囲があいまいです。「in this Agreement」「in this Section」のように書いてください`,
    },
]

const INCLUDING = [/\bincluding,? but not limited to,?/gi, /\bincluding,? without limitation,?/gi]

interface Node {
    type: string
    parent?: Node
}

interface Context {
    Syntax: { Str: string; DocumentExit: string }
    RuleError: new (message: string, options: { padding: unknown; fix?: unknown }) => unknown
    report: (node: Node, error: unknown) => void
    getSource: (node: Node) => string
    locator: { range: (range: [number, number]) => unknown }
    fixer: { replaceTextRange: (range: [number, number], text: string) => unknown }
}

const sameCase = (found: string, text: string) => (/^[A-Z]/.test(found) ? text[0].toUpperCase() + text.slice(1) : text)

function reporter(context: Context) {
    const { Syntax, RuleError, report, getSource, locator, fixer } = context
    const including: { node: Node; range: [number, number]; kind: number; text: string }[] = []
    return {
        [Syntax.Str](node: Node) {
            for (let p = node.parent; p; p = p.parent) if (SKIP.has(p.type)) return
            const src = getSource(node)
            if (!/[A-Za-z]/.test(src)) return
            for (const ph of PHRASES) {
                for (const m of src.matchAll(ph.re)) {
                    const range: [number, number] = [m.index, m.index + m[0].length]
                    report(
                        node,
                        new RuleError(
                            ph.message(m[0]),
                            ph.fix
                                ? { padding: locator.range(range), fix: fixer.replaceTextRange(range, sameCase(m[0], ph.fix)) }
                                : { padding: locator.range(range) },
                        ),
                    )
                }
            }
            INCLUDING.forEach((re, kind) => {
                for (const m of src.matchAll(re)) including.push({ node, range: [m.index, m.index + m[0].length], kind, text: m[0].replace(/,$/, '') })
            })
        },
        [Syntax.DocumentExit]() {
            const counts = [0, 0]
            for (const x of including) counts[x.kind]++
            if (!counts[0] || !counts[1]) return
            const minority = counts[0] < counts[1] ? 0 : 1
            const other = minority === 0 ? 'including without limitation' : 'including but not limited to'
            for (const x of including.filter((i) => i.kind === minority))
                report(x.node, new RuleError(`「${x.text}」と「${other}」が混ざっています。どちらかにそろえてください`, { padding: locator.range(x.range) }))
        },
    }
}

export const legalEnglish = { linter: reporter, fixer: reporter }
