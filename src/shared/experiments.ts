import { t, type Messages } from './i18n'

type Key = keyof Messages['labels']['experiments']
const info = (id: Key): { label: string; description: string } => t().labels.experiments[id]

// label と description は読むたびに今の言語で返す
const experiment = <const Id extends Key>(id: Id) => ({
    id,
    get label() {
        return info(id).label
    },
    get description() {
        return info(id).description
    },
})

export const EXPERIMENTS = [experiment('clauseLibrary'), experiment('lanAi'), experiment('houritsuExport'), experiment('cdsign')] as const

export type ExperimentId = (typeof EXPERIMENTS)[number]['id']

export const isEnabled = (s: { experiments?: Partial<Record<ExperimentId, boolean>> } | null | undefined, id: ExperimentId): boolean => !!s?.experiments?.[id]
