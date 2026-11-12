// 半角カタカナを見つける校正の規則（textlint の規則の形）。
// リンク・画像・引用・強調の中は、元の文をそのまま写していることが多いので見ない。
const HANKAKU = /[｡-ﾟ]+/g
const SKIP = new Set(['Link', 'Image', 'BlockQuote', 'Emphasis'])

interface Node {
    type: string
    parent?: Node
}

interface Context {
    Syntax: { Str: string }
    RuleError: new (message: string, options: { padding: unknown; fix: unknown }) => unknown
    report: (node: Node, error: unknown) => void
    getSource: (node: Node) => string
    locator: { range: (range: [number, number]) => unknown }
    fixer: { replaceTextRange: (range: [number, number], text: string) => unknown }
}

function reporter(context: Context) {
    const { Syntax, RuleError, report, getSource, locator, fixer } = context
    return {
        [Syntax.Str](node: Node) {
            for (let p = node.parent; p; p = p.parent) if (SKIP.has(p.type)) return
            for (const m of getSource(node).matchAll(HANKAKU)) {
                const range: [number, number] = [m.index, m.index + m[0].length]
                const zenkaku = m[0].normalize('NFKC')
                report(
                    node,
                    new RuleError(`「${m[0]}」は半角のカタカナです。全角の「${zenkaku}」にしてください`, {
                        padding: locator.range(range),
                        fix: fixer.replaceTextRange(range, zenkaku),
                    }),
                )
            }
        },
    }
}

export const noHankakuKana = { linter: reporter, fixer: reporter }
