import { t, type Messages } from './i18n'

export interface ProofreadRule {
    id: string
    label: string
    description: string
    // textlint の規則のパッケージ。ないものは ClauseDown の中で書いた規則
    pkg?: string
    defaultOn: boolean
}

type RuleId = keyof Messages['proofread']['rules']

// label と description は読むたびに今の言語で返す
const rule = (id: RuleId, pkg: string | undefined, defaultOn: boolean): ProofreadRule => ({
    id,
    get label() {
        return t().proofread.rules[id].label
    },
    get description() {
        return t().proofread.rules[id].description
    },
    ...(pkg ? { pkg } : {}),
    defaultOn,
})

export const PROOFREAD_RULES: ProofreadRule[] = [
    rule('no-doubled-joshi', 'textlint-rule-no-doubled-joshi', true),
    rule('no-dropping-the-ra', 'textlint-rule-no-dropping-the-ra', true),
    rule('no-double-negative-ja', 'textlint-rule-no-double-negative-ja', true),
    rule('no-mixed-zenkaku-and-hankaku-alphabet', 'textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet', true),
    rule('prh', 'textlint-rule-prh', true),
    rule('legal-terms', 'textlint-rule-prh', true),
    rule('legal-okurigana', 'textlint-rule-prh', true),
    rule('ja-no-abusage', 'textlint-rule-ja-no-abusage', true),
    rule('no-hankaku-kana', undefined, true),
    rule('legal-en', undefined, true),
    rule('max-ten', 'textlint-rule-max-ten', true),
    rule('ja-no-redundant-expression', 'textlint-rule-ja-no-redundant-expression', false),
]

export const DEFAULT_JOSHI_ALLOW = ['に', 'が', 'と', 'の', 'を', 'で', 'て', 'も', 'や', 'から', 'より', 'まで', 'に関する', 'について']

export const MAX_TEN = 6

export const ruleOn = (id: string, choices: Partial<Record<string, boolean>> | undefined): boolean =>
    choices?.[id] ?? PROOFREAD_RULES.find((r) => r.id === id)?.defaultOn ?? false

export const ruleLabel = (id: string): string => PROOFREAD_RULES.find((r) => r.id === id)?.label ?? id
