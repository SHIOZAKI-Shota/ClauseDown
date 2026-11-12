export type DocPreset = 'law' | 'contract'

const CONTRACT_CONFIG =
    '<!-- clausedown\nchapter: { numeral: arabic }\narticle: { title: inline }\nparagraph: { numeral: arabic }\nitem: { style: paren }\n-->\n'

export function newDocText(title: string, preset: DocPreset = 'law', body?: string): string {
    const config = preset === 'contract' ? CONTRACT_CONFIG : ''
    const start = body ?? (preset === 'contract' ? '### 目的\n- \n' : '## 総則\n\n### 目的\n- \n')
    return `# ${title}\n${config}\n${start}`
}
