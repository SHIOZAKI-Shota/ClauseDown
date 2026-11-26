import fs from 'node:fs'
import git from './igit'
import * as g from './git'
import { repoKey } from './repo-lock'

const rootMemo = new Map<string, string>()

export async function repoRoot(dir: string): Promise<string> {
	const key = repoKey(dir)
	const hit = rootMemo.get(key)
	if (hit) return hit
	const main = await g.mainBranch(dir)
	const commits = await git.log({ fs, dir, ref: main })
	const root = commits.at(-1)?.oid ?? ''
	if (root) rootMemo.set(key, root)
	return root
}
