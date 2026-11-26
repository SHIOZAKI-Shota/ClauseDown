import * as iso from 'isomorphic-git'
import { recent } from './memo'
import { repoKey } from './repo-lock'

const MAX_CACHED = 4
// isomorphic-git のキャッシュはパックファイルを丸ごと抱えるので、最近使ったリポジトリの分だけ残す
const caches = new Map<string, object>()
export const cacheFor = (dir: string) => recent(caches, repoKey(dir), () => ({}), MAX_CACHED)
export const dropCache = (dir: string) => caches.delete(repoKey(dir))

const git = new Proxy(iso.default, {
	get(target, key, recv) {
		const v = Reflect.get(target, key, recv)
		if (typeof v !== 'function') return v
		return (arg: unknown, ...rest: unknown[]) => {
			if (arg && typeof arg === 'object' && 'http' in arg) arg = { ...arg, corsProxy: '' }
			if (arg && typeof arg === 'object' && 'dir' in arg && !('cache' in arg)) {
				const dir = (arg as { dir: string }).dir
				arg = { ...arg, cache: cacheFor(dir) }
			}
			return (v as (...a: unknown[]) => unknown).call(target, arg, ...rest)
		}
	},
})

export default git
export const TREE = iso.TREE
