import type { Messages } from '../types'

export const proofread: Messages['proofread'] = {
    rules: {
        'no-doubled-joshi': { label: 'Repeated particles', description: 'The same Japanese particle appears twice in one sentence, as in 「甲は乙は」' },
        'no-dropping-the-ra': { label: 'Ra-dropping', description: 'Colloquial verb forms such as 「来れる」「見れる」' },
        'no-double-negative-ja': { label: 'Double negatives', description: 'Phrases such as 「しないことはない」' },
        'no-mixed-zenkaku-and-hankaku-alphabet': {
            label: 'Mixed full-width and half-width',
            description: 'Full-width and half-width Latin letters are mixed in the same document',
        },
        prh: { label: 'Character usage', description: 'Spellings that do not follow official and legislative style (「または」→「又は」, etc.)' },
        'legal-terms': {
            label: 'Legislative character usage',
            description:
                'Replacements from the Cabinet Legislation Bureau guidelines on kanji in legislation (「捺印」→「押印」, 「虞」→「おそれ」, 「斡旋」→「あっせん」, etc.)',
        },
        'legal-okurigana': {
            label: 'Legislative okurigana',
            description:
                'Okurigana from the same guidelines (「取り消しの」→「取消しの」, 「支払いを」→「支払を」, 「手続き」→「手続」, etc.). Flagged only when used as a noun',
        },
        'ja-no-abusage': { label: 'Common misuse', description: 'For example 「規定を適応する」 (→適用) and 「似て異なるもの」 (→似て非なるもの)' },
        'no-hankaku-kana': { label: 'Half-width kana', description: 'Half-width katakana such as 「ｶﾀｶﾅ」' },
        'legal-en': {
            label: 'English contract wording',
            description:
                'Ambiguous wording such as "and/or" and "herein", and stock phrases that can be shortened, such as "prior to" → "before". Does not apply to Japanese text',
        },
        'max-ten': { label: 'Too many commas', description: 'A sentence has too many Japanese commas (、). The limit is set high for legal text' },
        'ja-no-redundant-expression': {
            label: 'Redundant expressions',
            description: 'Phrases such as 「することができる」 and 「であると考えられる」. Also flags wording that is normal in legal text',
        },
    },
}
