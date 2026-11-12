import type { ProofreadConfig, ProofreadIssue } from '../shared/api'
import { noHankakuKana } from './proofread-hankaku'
import { LEGAL_OKURIGANA_YAML, LEGAL_TERMS_YAML } from './proofread-legal'
import { DEFAULT_JOSHI_ALLOW, MAX_TEN, PROOFREAD_RULES, ruleLabel, ruleOn } from '../shared/proofread-rules'

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

type Lint = (text: string, config: ProofreadConfig) => Promise<{ ruleId: string; message: string; range?: [number, number]; index: number; fix?: { range: [number, number] } }[]>
let lint: Promise<Lint> | null = null

const LOCAL_RULES: Record<string, unknown> = { 'no-hankaku-kana': noHankakuKana }

// CommonJS の規則を ESM から読むと { default: { default: 規則 } } のように何重にも包まれることがある
function unwrap(m: unknown): unknown {
    let cur = m
    while (cur && typeof cur === 'object' && 'default' in cur && !('linter' in cur) && !('Processor' in cur)) cur = (cur as { default: unknown }).default
    return cur
}

function optionsOf(id: string, config: ProofreadConfig): unknown {
    if (id === 'no-doubled-joshi') return { allow: config.joshiAllow ?? DEFAULT_JOSHI_ALLOW }
    if (id === 'max-ten') return { max: MAX_TEN }
    if (id === 'prh') return { ruleContents: [DICTIONARY, ...(config.dictionaries ?? [])] }
    if (id === 'legal-terms') return { ruleContents: [LEGAL_TERMS_YAML] }
    if (id === 'legal-okurigana') return { ruleContents: [LEGAL_OKURIGANA_YAML] }
    return true
}

async function load(): Promise<Lint> {
    const { TextlintKernel } = await import('@textlint/kernel')
    const markdown = unwrap(await import('@textlint/textlint-plugin-markdown'))
    const modules = new Map(await Promise.all(PROOFREAD_RULES.map(async (r) => [r.id, r.pkg ? unwrap(await import(r.pkg)) : LOCAL_RULES[r.id]] as const)))
    const kernel = new TextlintKernel()
    return async (text, config) => {
        const rules = PROOFREAD_RULES.filter((r) => ruleOn(r.id, config.rules)).map((r) => ({ ruleId: r.id, rule: modules.get(r.id), options: optionsOf(r.id, config) }))
        if (!rules.length) return []
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


export async function proofread(input: unknown, config: ProofreadConfig = {}): Promise<ProofreadIssue[]> {
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_CHARS) return []
    const text = input.replace(/\r\n?/g, '\n')
    lint ??= load().catch((e) => {
        lint = null
        throw e
    })
    const messages = await (await lint)(text, config)
    const ignored = ignoredRanges(text)
    const out: ProofreadIssue[] = []
    for (const m of messages) {
        const [from, to] = m.fix?.range ?? m.range ?? [m.index, m.index + 1]
        if (ignored.some(([a, b]) => from < b && to > a)) continue
        out.push({ from, to: Math.max(to, from + 1), rule: ruleLabel(m.ruleId), message: m.message.split('\n')[0].trim() })
    }
    return out
}
