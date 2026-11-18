export const AUTHOR = {
    name: 'SHIOZAKI Shota',
    email: 'me@shiozakishota.com',
    url: 'https://shiozakishota.com',
} as const

export const PROJECT = {
    repo: 'https://github.com/SHIOZAKI-Shota/ClauseDown',
    manual: 'https://clausedown.app/docs/manual/',
} as const

/** 画面の言語に合ったマニュアルの URL。英語版は manual/en/ にある */
export const manualUrl = (locale: 'ja' | 'en'): string => (locale === 'en' ? `${PROJECT.manual}en/` : PROJECT.manual)

export const GITHUB_APP = {
    clientId: 'Iv23liL1XTDcvEkXRTXl',
    installUrl: 'https://github.com/apps/clausedown/installations/new',
} as const

export const GITLAB_APP = {
    clientId: '20b0dd245772fc3761a5323a15b8ad079de0b24804b9085182ae3938b60ba0e1',
} as const
