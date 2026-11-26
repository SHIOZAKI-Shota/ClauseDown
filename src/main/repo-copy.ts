import fs, { promises as fsp } from 'node:fs'
import { sleep } from './util'
import { t } from '../shared/i18n'
import { join, resolve, sep } from 'node:path'
import git from './igit'
import { disconnectRemote } from './git'
import { remoteUrl } from './git-base'
import { loadSettings } from './settings'
import { knownBases, matchRemote } from '../shared/forge'
import * as gh from './github'
import * as gl from './gitlab'

const BAD_NAME = /[\\/:*?"<>|]/

export function checkFolderName(raw: string): string {
	const name = String(raw ?? '').trim()
	if (!name || name === '.' || name === '..' || BAD_NAME.test(name)) throw new Error(t().errors.repoCopy.badName)
	return name
}

async function emptyTarget(dest: string) {
	if (fs.existsSync(dest) && (await fsp.readdir(dest)).length) throw new Error(t().errors.repoCopy.exists(dest))
}

export async function duplicateRepo(src: string, parent: string, rawName: string): Promise<string> {
	const dest = join(parent, checkFolderName(rawName))
	if ((resolve(dest) + sep).toLowerCase().startsWith((resolve(src) + sep).toLowerCase())) throw new Error(t().errors.repoCopy.insideSource)
	await emptyTarget(dest)
	await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false })
	try {
		await disconnectRemote(dest)
		if ((await git.listRemotes({ fs, dir: dest })).some((r) => r.remote === 'upstream')) await git.deleteRemote({ fs, dir: dest, remote: 'upstream' })
		await fsp.rm(join(dest, '.git', 'clausedown-pending-untags'), { force: true })
		await fsp.rm(join(dest, '.git', 'clausedown-delivery-folders.json'), { force: true })
	} catch (e) {
		await fsp.rm(dest, { recursive: true, force: true })
		throw e
	}
	return dest
}

async function waitUntil(ready: () => Promise<boolean>) {
	for (let i = 0; i < 30; i++) {
		if (await ready()) return
		await sleep(2000)
	}
	throw new Error(t().errors.repoCopy.forkSlow)
}

export async function forkRepo(dir: string): Promise<string> {
	const url = await remoteUrl(dir)
	const m = matchRemote(url, knownBases(await loadSettings()))
	if (!url || !m) throw new Error(t().errors.repoCopy.forkUnsupported)
	let forkUrl: string
	if (m.kind === 'github') {
		const [owner, repo] = m.path.split('/')
		const f = await gh.forkRepo({ owner, repo })
		await waitUntil(() =>
			gh.getRepo(f.full_name).then(
				() => true,
				() => false,
			),
		)
		forkUrl = f.clone_url
	} else {
		const r = { base: m.base, path: m.path }
		const p = await gl.forkProject(r)
		await waitUntil(() =>
			gl.getProject(r, p.id).then(
				(x) => !x.import_status || x.import_status === 'finished' || x.import_status === 'none',
				() => false,
			),
		)
		forkUrl = p.http_url_to_repo
	}
	if (forkUrl.replace(/\.git$/i, '') === url.replace(/\.git$/i, '')) throw new Error(t().errors.repoCopy.forkOwn)
	if (!(await git.listRemotes({ fs, dir })).some((r) => r.remote === 'upstream')) await git.addRemote({ fs, dir, remote: 'upstream', url })
	await git.setConfig({ fs, dir, path: 'remote.origin.url', value: forkUrl })
	return forkUrl
}
