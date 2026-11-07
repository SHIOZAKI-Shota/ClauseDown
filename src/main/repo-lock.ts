import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'

export const repoKey = (dir: string) => {
    const r = resolve(dir)
    return process.platform === 'win32' ? r.toLowerCase() : r
}

const held = new AsyncLocalStorage<ReadonlySet<string>>()
const tails = new Map<string, Promise<void>>()

export function withRepoLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const key = repoKey(dir)
    const mine = held.getStore()
    if (mine?.has(key)) return fn()
    const prev = tails.get(key) ?? Promise.resolve()
    const run = prev.then(() => held.run(new Set([...(mine ?? []), key]), fn))
    const tail = run.then(
        () => { },
        () => { },
    )
    tails.set(key, tail)
    void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
    })
    return run
}
