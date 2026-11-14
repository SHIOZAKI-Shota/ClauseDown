import type { ProofreadConfig } from '@shared/api'

interface Request {
    id: number
    text: string
    config: ProofreadConfig
    dicPath: string
}

const scope = self as unknown as { window?: unknown; kuromojin?: { dicPath: string } }
scope.window = self
;(self as unknown as { process?: unknown }).process ??= {
    env: {},
    cwd: () => '/',
    platform: 'browser',
    version: '',
    versions: {},
    nextTick: (fn: () => void) => queueMicrotask(fn),
}

const RULES: Record<string, () => Promise<unknown>> = {
    'textlint-rule-no-doubled-joshi': () => import('textlint-rule-no-doubled-joshi'),
    'textlint-rule-no-dropping-the-ra': () => import('textlint-rule-no-dropping-the-ra'),
    'textlint-rule-no-double-negative-ja': () => import('textlint-rule-no-double-negative-ja'),
    'textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet': () => import('textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet'),
    'textlint-rule-prh': () => import('textlint-rule-prh'),
    'textlint-rule-ja-no-abusage': () => import('textlint-rule-ja-no-abusage'),
    'textlint-rule-max-ten': () => import('textlint-rule-max-ten'),
    'textlint-rule-ja-no-redundant-expression': () => import('textlint-rule-ja-no-redundant-expression'),
}

const core = import('../../main/proofread-core').then((m) => {
    m.setRuleLoader((pkg) => {
        const load = RULES[pkg]
        if (!load) throw new Error(`校正の規則 ${pkg} はデモに入っていません`)
        return load()
    })
    return m
})

self.onmessage = async (e: MessageEvent<Request>) => {
    const { id, text, config, dicPath } = e.data
    scope.kuromojin = { dicPath }
    try {
        const result = await (await core).proofread(text, config)
        self.postMessage({ id, result })
    } catch (err) {
        self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
    }
}
