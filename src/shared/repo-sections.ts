export interface Sectioned {
    dir: string
    section?: string
}

export interface RepoGroup<T> {
    section: string
    repos: T[]
}

export function cleanSection(s: unknown): string | undefined {
    const v = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 40) : ''
    return v || undefined
}

const sectionOf = (r: Sectioned) => cleanSection(r.section) ?? ''

export function groupRepos<T extends Sectioned>(repos: T[]): RepoGroup<T>[] {
    const map = new Map<string, T[]>()
    for (const r of repos) {
        const s = sectionOf(r)
        const list = map.get(s)
        if (list) list.push(r)
        else map.set(s, [r])
    }
    const groups = [...map].map(([section, list]) => ({ section, repos: list }))
    return [...groups.filter((g) => !g.section), ...groups.filter((g) => g.section)]
}

export function sectionNames(repos: Sectioned[]): string[] {
    return groupRepos(repos)
        .map((g) => g.section)
        .filter(Boolean)
}

const withSection = <T extends Sectioned>(r: T, section: string | undefined): T => {
    const { section: _old, ...rest } = r
    return (section ? { ...rest, section } : rest) as T
}

export function placeRepo<T extends Sectioned>(repos: T[], dir: string, to: { section?: string; before?: string }): T[] {
    const moving = repos.find((r) => r.dir === dir)
    if (!moving || to.before === dir) return repos
    const section = cleanSection(to.section)
    const rest = repos.filter((r) => r.dir !== dir)
    const item = withSection(moving, section)
    let at = to.before ? rest.findIndex((r) => r.dir === to.before) : -1
    if (at < 0) {
        const last = rest.map((r) => sectionOf(r)).lastIndexOf(section ?? '')
        at = last < 0 ? rest.length : last + 1
    }
    return [...rest.slice(0, at), item, ...rest.slice(at)]
}

export function renameSection<T extends Sectioned>(repos: T[], from: string, to: string): T[] {
    const next = cleanSection(to)
    return repos.map((r) => (sectionOf(r) === from ? withSection(r, next) : r))
}

export function dissolveSection<T extends Sectioned>(repos: T[], name: string): T[] {
    return repos.map((r) => (sectionOf(r) === name ? withSection(r, undefined) : r))
}
