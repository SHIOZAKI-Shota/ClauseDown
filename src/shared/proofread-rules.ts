export interface ProofreadRule {
    id: string
    label: string
    description: string
    pkg: string
    defaultOn: boolean
}

export const PROOFREAD_RULES: ProofreadRule[] = [
    { id: 'no-doubled-joshi', label: '同じ助詞の連続', description: '「甲は乙は」のように、同じ助詞が一文に重なっている', pkg: 'textlint-rule-no-doubled-joshi', defaultOn: true },
    { id: 'no-dropping-the-ra', label: 'ら抜き言葉', description: '「来れる」「見れる」', pkg: 'textlint-rule-no-dropping-the-ra', defaultOn: true },
    { id: 'no-double-negative-ja', label: '二重否定', description: '「しないことはない」', pkg: 'textlint-rule-no-double-negative-ja', defaultOn: true },
    { id: 'no-mixed-zenkaku-and-hankaku-alphabet', label: '全角・半角の混在', description: '同じ文書で英字の全角と半角が混ざっている', pkg: 'textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet', defaultOn: true },
    { id: 'prh', label: '用字', description: '公用文・法令の書き方に合わない字（「または」→「又は」など）', pkg: 'textlint-rule-prh', defaultOn: true },
    { id: 'legal-terms', label: '法令の用字', description: '内閣法制局「法令における漢字使用等について」の言い換え（「捺印」→「押印」、「虞」→「おそれ」、「斡旋」→「あっせん」など）', pkg: 'textlint-rule-prh', defaultOn: true },
    { id: 'legal-okurigana', label: '法令の送り仮名', description: '同じ決定の送り仮名（「取り消しの」→「取消しの」、「支払いを」→「支払を」、「手続き」→「手続」など）。名詞として使っているときだけ指摘します', pkg: 'textlint-rule-prh', defaultOn: true },
    { id: 'ja-no-abusage', label: 'よくある誤用', description: '「規定を適応する」（→適用）、「似て異なるもの」（→似て非なるもの）など', pkg: 'textlint-rule-ja-no-abusage', defaultOn: true },
    { id: 'no-hankaku-kana', label: '半角カナ', description: '「ｶﾀｶﾅ」のような半角のカタカナ', pkg: 'textlint-rule-no-hankaku-kana', defaultOn: true },
    { id: 'max-ten', label: '読点の多い文', description: '一文に読点（、）が多すぎる。条文向けに上限を多めにしています', pkg: 'textlint-rule-max-ten', defaultOn: true },
    { id: 'ja-no-redundant-expression', label: '冗長な表現', description: '「することができる」「であると考えられる」など。条文では普通の言い回しも指摘します', pkg: 'textlint-rule-ja-no-redundant-expression', defaultOn: false },
]

export const DEFAULT_JOSHI_ALLOW = ['に', 'が', 'と', 'の', 'を', 'で', 'て', 'も', 'や', 'から', 'より', 'まで', 'に関する', 'について']

export const MAX_TEN = 6

export const ruleOn = (id: string, choices: Partial<Record<string, boolean>> | undefined): boolean =>
    choices?.[id] ?? PROOFREAD_RULES.find((r) => r.id === id)?.defaultOn ?? false

export const ruleLabel = (id: string): string => PROOFREAD_RULES.find((r) => r.id === id)?.label ?? id
