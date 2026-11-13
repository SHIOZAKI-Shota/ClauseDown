export const EXPERIMENTS = [
    {
        id: 'clauseLibrary',
        label: '条項ライブラリ',
        description: 'よく使う条をライブラリ用のリポジトリにまとめておき、「挿入」から文書に入れます。条参照は挿入するときに、入れる先の条に対応づけます。',
    },
    {
        id: 'houritsuExport',
        label: 'Markdown（houritsu）に書き出す',
        description: '書き出しのメニューに、条番号・項番号を本文に書き込んだ houritsu の形式の Markdown に書き出す項目を出します。',
    },
] as const

export type ExperimentId = (typeof EXPERIMENTS)[number]['id']

export const isEnabled = (s: { experiments?: Partial<Record<ExperimentId, boolean>> } | null | undefined, id: ExperimentId): boolean => !!s?.experiments?.[id]
