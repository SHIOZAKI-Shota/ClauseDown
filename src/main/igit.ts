import * as iso from 'isomorphic-git'
import { repoKey } from './repo-lock'

const MAX_CACHED = 4
// isomorphic-git のキャッシュはパックファイルを丸ごと抱えるので、最近使ったリポジトリの分だけ残す
const caches = new Map<string, object>()
export const cacheFor = (dir: string) => {
    const key = repoKey(dir)
    let c = caches.get(key)
    if (c) caches.delete(key)
    else c = {}
    caches.set(key, c)
    while (caches.size > MAX_CACHED) caches.delete(caches.keys().next().value!)
    return c
}
export const dropCache = (dir: string) => caches.delete(repoKey(dir))

type Iso = typeof iso.default
const git = new Proxy(iso.default, {
    get(target, key, recv) {
        const v = Reflect.get(target, key, recv)
        if (typeof v !== 'function') return v
        return (arg: unknown, ...rest: unknown[]) => {
            if (arg && typeof arg === 'object' && 'dir' in arg && !('cache' in arg)) {
                const dir = (arg as { dir: string }).dir
                arg = { ...arg, cache: cacheFor(dir) }
            }
            return (v as (...a: unknown[]) => unknown).call(target, arg, ...rest)
        }
    },
}) as Iso

export default git
export const TREE = iso.TREE
