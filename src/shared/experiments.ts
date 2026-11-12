export const EXPERIMENTS = [
    {
        id: 'clauseLibrary',
        label: '条項ライブラリ',
        description: 'よく使う条をライブラリ用のリポジトリにまとめておき、「挿入」から文書に入れます。条参照は挿入するときに、入れる先の条に対応づけます。',
    },
] as const

export type ExperimentId = (typeof EXPERIMENTS)[number]['id']

export const isEnabled = (s: { experiments?: Partial<Record<ExperimentId, boolean>> } | null | undefined, id: ExperimentId): boolean => !!s?.experiments?.[id]
