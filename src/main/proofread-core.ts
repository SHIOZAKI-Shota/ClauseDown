import type { ProofreadIssue } from '../shared/api'

const MAX_CHARS = 200_000

const DICTIONARY = `version: 1
rules:
  - expected: 又は
    pattern: または
  - expected: 若しくは
    pattern: もしくは
  - expected: 及び
    pattern: および
  - expected: 並びに
    pattern: ならびに
  - expected: 直ちに
    pattern: ただちに
  - expected: ただし
    pattern: 但し
  - expected: なお、
    pattern: 尚、
  - expected: あらかじめ
    pattern: 予め
  - expected: ほとんど
    pattern: 殆ど
  - expected: ください
    pattern: 下さい
  - expected: よろしく
    pattern: 宜しく
  - expected: まで
    pattern: 迄
  - expected: おいて
    pattern: 於いて
  - expected: おける
    pattern: 於ける
  - expected: できる
    pattern: 出来る
  - expected: できない
    pattern: 出来ない
  - expected: できます
    pattern: 出来ます
  - expected: いたします
    pattern: 致します
  - expected: いただく
    pattern: 頂く
`

const RULES: { id: string; label: string; pkg: string; options?: unknown }[] = [
    {
        id: 'no-doubled-joshi',
        label: '同じ助詞の連続',
        pkg: 'textlint-rule-no-doubled-joshi',
        // 条文は一文が長く「に」「が」などが重なるのが普通なので、「は」の重なりなどに絞る
        options: { allow: ['に', 'が', 'と', 'の', 'を', 'で', 'て', 'も', 'や', 'から', 'より', 'まで', 'に関する', 'について'] },
    },
    { id: 'no-dropping-the-ra', label: 'ら抜き言葉', pkg: 'textlint-rule-no-dropping-the-ra' },
    { id: 'no-double-negative-ja', label: '二重否定', pkg: 'textlint-rule-no-double-negative-ja' },
    { id: 'no-mixed-zenkaku-and-hankaku-alphabet', label: '全角・半角の混在', pkg: 'textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet' },
    { id: 'prh', label: '用字', pkg: 'textlint-rule-prh', options: { ruleContents: [DICTIONARY] } },
]

type Lint = (text: string) => Promise<{ ruleId: string; message: string; range?: [number, number]; index: number; fix?: { range: [number, number] } }[]>
let lint: Promise<Lint> | null = null

// CommonJS の規則を ESM から読むと { default: { default: 規則 } } のように何重にも包まれることがある
function unwrap(m: unknown): unknown {
    let cur = m
    while (cur && typeof cur === 'object' && 'default' in cur && !('linter' in cur) && !('Processor' in cur)) cur = (cur as { default: unknown }).default
    return cur
}

async function load(): Promise<Lint> {
    const { TextlintKernel } = await import('@textlint/kernel')
    const markdown = unwrap(await import('@textlint/textlint-plugin-markdown'))
    const rules = await Promise.all(RULES.map(async (r) => ({ ruleId: r.id, rule: unwrap(await import(r.pkg)), options: r.options })))
    const kernel = new TextlintKernel()
    return async (text) => {
        const res = await kernel.lintText(text, {
            ext: '.md',
            filePath: 'document.md',
            plugins: [{ pluginId: 'markdown', plugin: markdown as never }],
            rules: rules as never,
        })
        return res.messages as never
    }
}

export function ignoredRanges(source: string): [number, number][] {
    const out: [number, number][] = []
    const add = (re: RegExp) => {
        for (const m of source.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
    }
    add(/^---\n[\s\S]*?\n---(?=\n|$)/g)
    add(/<!--[\s\S]*?-->/g)
    add(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\1[ \t]*$/gm)
    add(/\[\[[^\]\n]*\]\]/g)
    add(/\{[^{}\n]*\}/g)
    add(/^[ \t]*:{3,}[^\n]*$/gm)
    return out
}

const LABEL = new Map(RULES.map((r) => [r.id, r.label]))

export async function proofread(input: unknown): Promise<ProofreadIssue[]> {
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_CHARS) return []
    const text = input.replace(/\r\n?/g, '\n')
    lint ??= load().catch((e) => {
        lint = null
        throw e
    })
    const messages = await (await lint)(text)
    const ignored = ignoredRanges(text)
    const out: ProofreadIssue[] = []
    for (const m of messages) {
        const [from, to] = m.fix?.range ?? m.range ?? [m.index, m.index + 1]
        if (ignored.some(([a, b]) => from < b && to > a)) continue
        out.push({ from, to: Math.max(to, from + 1), rule: LABEL.get(m.ruleId) ?? m.ruleId, message: m.message.split('\n')[0].trim() })
    }
    return out
}
