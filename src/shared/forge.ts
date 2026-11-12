export type ForgeKind = 'github' | 'gitlab'

export const FORGE_LABEL: Record<ForgeKind, string> = { github: 'GitHub', gitlab: 'GitLab' }

export const GITHUB_BASE = 'https://github.com'
export const GITLAB_BASE = 'https://gitlab.com'

export interface GitLabHost {
    url: string
    clientId?: string
}

export interface ForgeBase {
    base: string
    kind: ForgeKind
}

export function reviewRefLabel(kind: ForgeKind, n: number): string {
    return kind === 'gitlab' ? `GitLab のマージリクエスト !${n}` : `GitHub のプルリクエスト #${n}`
}

export function normalizeBase(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    let u: URL
    try {
        u = new URL(raw.trim())
    } catch {
        return null
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(u.host)) return null
    const path = u.pathname.replace(/\/+$/, '')
    if (path.split('/').some((s) => s === '..' || s === '.')) return null
    return `https://${u.host.toLowerCase()}${path}`
}

export function cleanGitLabHosts(list: unknown): GitLabHost[] {
    const out: GitLabHost[] = []
    for (const h of Array.isArray(list) ? list : []) {
        const url = normalizeBase((h as GitLabHost)?.url)
        if (!url || url === GITHUB_BASE || url === GITLAB_BASE || out.some((o) => o.url === url)) continue
        const id = String((h as GitLabHost).clientId ?? '').trim()
        out.push(id && /^[\w.-]{1,200}$/.test(id) ? { url, clientId: id } : { url })
    }
    return out
}

export function knownBases(settings: { gitlabHosts?: GitLabHost[] }): ForgeBase[] {
    return [
        { base: GITHUB_BASE, kind: 'github' },
        { base: GITLAB_BASE, kind: 'gitlab' },
        ...cleanGitLabHosts(settings.gitlabHosts).map((h) => ({ base: h.url, kind: 'gitlab' as const })),
    ]
}

export function underBase(url: string, base: string): boolean {
    return url === base || url.toLowerCase().startsWith(base.toLowerCase() + '/')
}

export interface RemoteMatch extends ForgeBase {
    path: string
}

export function matchRemote(url: string | null | undefined, bases: ForgeBase[]): RemoteMatch | null {
    if (!url) return null
    let u: URL
    try {
        u = new URL(url.trim())
    } catch {
        return null
    }
    if (u.protocol !== 'https:' || u.search || u.hash) return null
    const clean = `https://${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`
    const hit = [...bases].sort((a, b) => b.base.length - a.base.length).find((b) => underBase(clean, b.base))
    if (!hit) return null
    const path = clean.slice(hit.base.length + 1).replace(/\.git$/i, '')
    const parts = path.split('/')
    if (parts.some((p) => !p || p === '.' || p === '..' || p === '-')) return null
    if (hit.kind === 'github' ? parts.length !== 2 : parts.length < 2) return null
    return { ...hit, path }
}

export function isRepoUrlFor(url: string, base: ForgeBase): boolean {
    const m = matchRemote(url, [base])
    return !!m && m.base === base.base
}

export function newRepoUrl(b: ForgeBase, name: string): string {
    return b.kind === 'github' ? `${b.base}/new?name=${encodeURIComponent(name)}&visibility=private` : `${b.base}/projects/new#blank_project`
}

export function baseLabel(b: ForgeBase): string {
    if (b.base === GITHUB_BASE) return 'GitHub'
    if (b.base === GITLAB_BASE) return 'GitLab.com'
    return `GitLab（${b.base.replace(/^https:\/\//, '')}）`
}
