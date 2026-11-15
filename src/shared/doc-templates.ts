import type { DocLang } from './legal-styles'

// 挿入ボタンが文書に入れる雛形。文書の中身なので、画面の言語ではなく文書の言語に従う
export interface Template {
    body: string
    cursor: string
}

const JA = {
    supplement: { body: '\n## 附則 {supplement}\n- この規則は、　年　月　日から施行する。\n', cursor: '　年' },
    closing: {
        body: '\n## {closing}\n本契約の成立を証するため、本書2通を作成し、甲乙記名押印のうえ、各1通を保有する。\n\n　年　月　日\n\n甲　\n\n乙　\n',
        cursor: '本契約',
    },
    table: ['| 区分 | 内容 |', '|---|---|', '| ・・・ | ・・・ |'],
    math: '\\text{補助金の額} = \\min\\left(\\dfrac{2}{3}C,\\ 1{,}000{,}000\\right)',
    flow: ['  A[申請] --> B[承認]', '  B --> C[実施]'],
    figure: '図',
    appendix: '別表第一',
}

const EN: typeof JA = {
    supplement: { body: '\n## Transitional Provisions {supplement}\n- These provisions take effect on [date].\n', cursor: '[date]' },
    closing: {
        body: '\n## {closing}\nIN WITNESS WHEREOF, the Parties have executed this Agreement as of the date first written above.\n\n[Party A]\n\nBy: ____________\n\n[Party B]\n\nBy: ____________\n',
        cursor: 'IN WITNESS',
    },
    table: ['| Item | Details |', '|---|---|', '| ... | ... |'],
    math: '\\text{Grant} = \\min\\left(\\dfrac{2}{3}C,\\ 1{,}000{,}000\\right)',
    flow: ['  A[Application] --> B[Approval]', '  B --> C[Implementation]'],
    figure: 'Figure',
    appendix: 'Schedule 1',
}

export const docTemplates = (lang: DocLang | undefined) => (lang && lang !== 'ja' ? EN : JA)
